/* WebGL2 glyph-atlas renderer. Rasterize monochrome glyphs once; tint/position on GPU. */
(() => {
  'use strict';
  class GlyphRenderer {
    constructor(canvas, options={}) {
      this.canvas=canvas;
      const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:true,preserveDrawingBuffer:false});
      if(!gl)throw new Error('WebGL2 context unavailable');
      this.gl=gl;
      this.pixelRatio=Math.max(1,Math.min(1.5,options.pixelRatio||1));
      this.atlasSize=Math.min(2048,gl.getParameter(gl.MAX_TEXTURE_SIZE)||2048);
      if(this.atlasSize<512)throw new Error('Texture limit too small');
      this.maxPages=2;
      this.textures=[];
      this.glyphs=new Map();
      this.layouts=new Map();
      this.advances=new Map();
      const measureCanvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(2,2):document.createElement('canvas');
      this.measureCtx=measureCanvas.getContext('2d',{alpha:true});
      this.missingGlyphs=0;
      this.frame=0;
      this.used=0;this.frameTouched=new Set();
      this.width=1;this.height=1;
      this._setup();
    }
    _compile(type,source) {
      const gl=this.gl, shader=gl.createShader(type);
      gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
        const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error('Shader compile: '+error);
      }
      return shader;
    }
    _setup() {
      const gl=this.gl;
      const vs=this._compile(gl.VERTEX_SHADER,`#version 300 es
      precision highp float;
      layout(location=0) in vec2 a_pos;
      layout(location=1) in vec2 a_uv;
      layout(location=2) in vec3 a_color;
      uniform vec2 u_resolution;
      out vec2 v_uv;out vec3 v_color;
      void main(){vec2 p=a_pos/u_resolution;gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0.0,1.0);v_uv=a_uv;v_color=a_color;}`);
      const fs=this._compile(gl.FRAGMENT_SHADER,`#version 300 es
      precision mediump float;
      in vec2 v_uv;in vec3 v_color;
      uniform sampler2D u_atlas;uniform float u_opacity;
      out vec4 color;
      void main(){vec4 mask=texture(u_atlas,v_uv);color=vec4(mask.r*v_color*u_opacity,mask.a*u_opacity);}`);
      const program=gl.createProgram();
      gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
      gl.deleteShader(vs);gl.deleteShader(fs);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Shader link: '+gl.getProgramInfoLog(program));
      this.program=program;this.resolution=gl.getUniformLocation(program,'u_resolution');
      this.opacity=gl.getUniformLocation(program,'u_opacity');this.sampler=gl.getUniformLocation(program,'u_atlas');
      this.buffer=gl.createBuffer();this.vao=gl.createVertexArray();
      gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      const stride=7*4;
      gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,stride,0);
      gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,stride,2*4);
      gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,3,gl.FLOAT,false,stride,4*4);
      gl.bindVertexArray(null);
      gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      this._newPage();
    }
    _newPage() {
      const gl=this.gl, texture=gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,this.atlasSize,this.atlasSize,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      this.textures.push({texture,x:1,y:1,rowHeight:0,stamp:++this.frame});
      return this.textures.length-1;
    }
    _allocate(w,h) {
      const size=this.atlasSize;
      if(w+2>size||h+2>size)return null;
      for(let i=this.textures.length-1;i>=0;i--){
        const p=this.textures[i];
        let x=p.x,y=p.y,row=p.rowHeight;
        if(x+w+1>size){x=1;y+=row+1;row=0;}
        if(y+h+1>size)continue;
        p.x=x+w+1;p.y=y;p.rowHeight=Math.max(row,h);
        p.stamp=++this.frame;
        return {page:i,x,y};
      }
      if(this.textures.length<this.maxPages){this._newPage();return this._allocate(w,h);}
      // Evict a whole page, not individual glyphs, so atlas coordinates never alias.
      let oldest=0;
      for(let i=1;i<this.textures.length;i++)if(this.textures[i].stamp<this.textures[oldest].stamp)oldest=i;
      if(this.frameTouched.has(oldest)){
        oldest=this.textures.findIndex((page,index)=>!this.frameTouched.has(index));
        if(oldest===-1)return null;
      }
      const p=this.textures[oldest];p.x=1;p.y=1;p.rowHeight=0;p.stamp=++this.frame;
      const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,p.texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      for(const [key,g] of this.glyphs)if(g.page===oldest)this.glyphs.delete(key);
      return this._allocate(w,h);
    }
    _glyph(text,size) {
      const key=size+'\0'+text,old=this.glyphs.get(key);
      if(old){this.textures[old.page].stamp=++this.frame;this.frameTouched.add(old.page);return old;}
      const scale=this.pixelRatio;
      const surface=typeof OffscreenCanvas==='function'?new OffscreenCanvas(2,2):document.createElement('canvas');
      const ctx=surface.getContext('2d',{alpha:true});
      if(!ctx)return null;
      ctx.font=`700 ${size*scale}px system-ui, sans-serif`;
      const advance=Math.max(1,ctx.measureText(text).width/scale);
      const pad=Math.max(3,Math.ceil(size*scale/7)+2);
      const w=Math.max(1,Math.ceil(advance*scale+pad*2));
      const h=Math.max(1,Math.ceil(size*scale*1.32+pad*2));
      surface.width=w;surface.height=h;
      ctx.font=`700 ${size*scale}px system-ui, sans-serif`;
      ctx.lineJoin='round';ctx.lineWidth=Math.max(2.6*scale,size*scale/7);
      ctx.strokeStyle='rgba(0,0,0,.86)';ctx.fillStyle='#ffffff';
      ctx.textBaseline='middle';
      ctx.strokeText(text,pad,h/2);ctx.fillText(text,pad,h/2);
      const place=this._allocate(w,h);
      if(!place)return null;
      const gl=this.gl;
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.textures[place.page].texture);
      // The quads use v0 at the top and v1 at the bottom. Canvas pixels are
      // uploaded top-row-first into the texture's v0 row; flipping here would
      // render every glyph upside down in WebGL2.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
      gl.texSubImage2D(gl.TEXTURE_2D,0,place.x,place.y,gl.RGBA,gl.UNSIGNED_BYTE,surface);
      const result={page:place.page,x:place.x,y:place.y,w,h,advance,pad,scale};
      this.glyphs.set(key,result);this.frameTouched.add(place.page);
      return result;
    }
    _advance(char,size){
      const key=size+'\0'+char;
      const cached=this.advances.get(key);
      if(cached!==undefined)return cached;
      const ctx=this.measureCtx;
      if(ctx)ctx.font=`700 ${size*this.pixelRatio}px system-ui, sans-serif`;
      const width=ctx?Math.max(1,ctx.measureText(char).width/this.pixelRatio):size;
      this.advances.set(key,width);
      if(this.advances.size>8000)this.advances.clear();
      return width;
    }
    _layout(text,size,centered) {
      const key=size+'\0'+(centered?'1':'0')+'\0'+text;
      let result=this.layouts.get(key);
      if(result){this.layouts.delete(key);this.layouts.set(key,result);return result;}
      const segmenter=typeof Intl?.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
      const lines=String(text).split('\n');
      // Relative positions and glyph keys are independent of each atlas eviction.
      const rows=lines.map(line=>{
        const chars=segmenter?Array.from(segmenter.segment(line),part=>part.segment):Array.from(line);
        let x=0;
        const items=[];
        for(const char of chars){
          items.push({char,x});x+=this._advance(char,size);
        }
        return {items,width:x};
      });
      const max=Math.max(0,...rows.map(row=>row.width));
      result={rows,width:max};
      this.layouts.set(key,result);
      if(this.layouts.size>2000)this.layouts.delete(this.layouts.keys().next().value);
      return result;
    }
    resize(width,height){this.width=Math.max(1,width);this.height=Math.max(1,height);this.gl.viewport(0,0,this.canvas.width,this.canvas.height);}
    clear(){const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}
    begin(opacity=1){this.clear();this.used=0;this.missingGlyphs=0;this.frameTouched.clear();this.groups=this.textures.map(()=>[]);this.alpha=opacity;this.frame++;}
    drawText(text,x,y,size,color,centered=false){
      const layout=this._layout(text,size,centered);
      const step=Math.ceil(size*1.22+4),drawWidth=layout.width;
      const rgb=[1,1,1];
      if(/^#[\da-f]{6}$/i.test(color)){rgb[0]=parseInt(color.slice(1,3),16)/255;rgb[1]=parseInt(color.slice(3,5),16)/255;rgb[2]=parseInt(color.slice(5,7),16)/255;}
      for(let row=0;row<layout.rows.length;row++){
        const line=layout.rows[row];
        const origin=x+(centered?(drawWidth-line.width)/2:0);
        for(const entry of line.items){
          const g=this._glyph(entry.char,size);
          if(!g){this.missingGlyphs++;continue;}
          const px=origin+entry.x-g.pad/g.scale;
          const py=y+row*step+(step-g.h/g.scale)/2;
          const x0=px,x1=px+g.w/g.scale,y0=py,y1=py+g.h/g.scale;
          const u0=g.x/this.atlasSize,u1=(g.x+g.w)/this.atlasSize;
          const v0=g.y/this.atlasSize,v1=(g.y+g.h)/this.atlasSize;
          const verts=this.groups[g.page] || (this.groups[g.page]=[]);
          const push=(xx,yy,uu,vv)=>verts.push(xx,yy,uu,vv,...rgb);
          push(x0,y0,u0,v0);push(x1,y0,u1,v0);push(x0,y1,u0,v1);
          push(x0,y1,u0,v1);push(x1,y0,u1,v0);push(x1,y1,u1,v1);
          this.used++;
        }
      }
    }
    end(){
      const gl=this.gl;gl.useProgram(this.program);
      gl.uniform2f(this.resolution,this.width,this.height);
      gl.uniform1f(this.opacity,this.alpha);
      gl.uniform1i(this.sampler,0);
      gl.activeTexture(gl.TEXTURE0);gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      for(let i=0;i<this.groups.length;i++){
        const vertices=this.groups[i];if(!vertices?.length)continue;
        gl.bindTexture(gl.TEXTURE_2D,this.textures[i].texture);
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STREAM_DRAW);
        gl.drawArrays(gl.TRIANGLES,0,vertices.length/7);
      }
      gl.bindVertexArray(null);
    }
    clearCache(){this.layouts.clear();this.glyphs.clear();this.advances.clear();for(const p of this.textures){p.x=1;p.y=1;p.rowHeight=0;this.gl.bindTexture(this.gl.TEXTURE_2D,p.texture);this.gl.texImage2D(this.gl.TEXTURE_2D,0,this.gl.RGBA,this.atlasSize,this.atlasSize,0,this.gl.RGBA,this.gl.UNSIGNED_BYTE,null);}}
    destroy(){const gl=this.gl;for(const p of this.textures)gl.deleteTexture(p.texture);gl.deleteBuffer(this.buffer);gl.deleteVertexArray(this.vao);gl.deleteProgram(this.program);this.textures.length=0;this.glyphs.clear();this.layouts.clear();this.advances.clear();}
  }
  globalThis.KomeMakuGL=GlyphRenderer;
  if(typeof module==='object'&&module.exports)module.exports=GlyphRenderer;
})();
