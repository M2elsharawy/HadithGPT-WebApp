export class QuranAudioProcessor {
  static async process(url: string, _opts: object, onProgress?: (p: {stage:string;percent:number})=>void): Promise<Blob> {
    onProgress?.({stage:"تحميل...", percent:20});
    const r = await fetch(url);
    const ab = await r.arrayBuffer();
    onProgress?.({stage:"معالجة...", percent:60});
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(ab);
    let peak = 0;
    for (let ch=0;ch<buf.numberOfChannels;ch++){const d=buf.getChannelData(ch);for(let i=0;i<d.length;i++){const v=Math.abs(d[i]);if(v>peak)peak=v;}}
    const gain = peak>0.001?Math.min(0.98/peak,4):1;
    const out = ctx.createBuffer(buf.numberOfChannels,buf.length,buf.sampleRate);
    for(let ch=0;ch<buf.numberOfChannels;ch++){const s=buf.getChannelData(ch),d=out.getChannelData(ch);for(let i=0;i<s.length;i++)d[i]=s[i]*gain;}
    await ctx.close();
    onProgress?.({stage:"تصدير...", percent:90});
    const nch=out.numberOfChannels,len=out.length,sr=out.sampleRate;
    const ab2=new ArrayBuffer(44+len*nch*2),v=new DataView(ab2);
    const w=(o:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    w(0,'RIFF');v.setUint32(4,36+len*nch*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);
    v.setUint16(22,nch,true);v.setUint32(24,sr,true);v.setUint32(28,sr*nch*2,true);v.setUint16(32,nch*2,true);v.setUint16(34,16,true);
    w(36,'data');v.setUint32(40,len*nch*2,true);
    let off=44;for(let i=0;i<len;i++)for(let ch=0;ch<nch;ch++){const s=out.getChannelData(ch)[i];v.setInt16(off,s<0?s*32768:s*32767,true);off+=2;}
    onProgress?.({stage:"اكتمل", percent:100});
    return new Blob([ab2],{type:'audio/wav'});
  }
  static buildOutputFileName(name: string): string {
    return name.replace(/\.[^.]+$/, '') + '-cleaned.wav';
  }
}
