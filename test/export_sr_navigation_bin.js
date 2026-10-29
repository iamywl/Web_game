const fs=require('fs'),path=require('path'),zlib=require('zlib');
const root=path.resolve(__dirname,'../..'),names=new Map();
for(const file of fs.readdirSync(path.join(root,'garen-viewer/tools/hashes')).filter(f=>/^(binfields|bintypes|binhashes|binentries|game)-.*\.lhdb$/.test(f))){
 const b=fs.readFileSync(path.join(root,'garen-viewer/tools/hashes',file)),n=Number(b.readBigUInt64LE(16)),hashOffset=Number(b.readBigUInt64LE(24)),offsets=Number(b.readBigUInt64LE(32)),dataOffset=Number(b.readBigUInt64LE(40)),hashBytes=(offsets-hashOffset)/n,data=zlib.zstdDecompressSync(b.subarray(dataOffset));
 const lengths=offsets+4*n;
 for(let i=0;i<n;i++){const h=hashBytes===8?b.readBigUInt64LE(hashOffset+i*8).toString(16):b.readUInt32LE(hashOffset+i*4).toString(16),o=b.readUInt32LE(offsets+i*4),len=b.readUInt16LE(lengths+i*2);names.set(h,data.subarray(o,o+len).toString());}
}
const b=fs.readFileSync(process.argv[2]);let o=4;
const u8=()=>b.readUInt8(o++),u16=()=>{const v=b.readUInt16LE(o);o+=2;return v},u32=()=>{const v=b.readUInt32LE(o);o+=4;return v},name=h=>names.get(h.toString(16))||'0x'+h.toString(16),str=()=>{const n=u16(),v=b.subarray(o,o+n).toString();o+=n;return v};
function fields(){const n=u16(),obj={};for(let i=0;i<n;i++){const k=name(u32()),t=u8();obj[k]=value(t);}return obj;}
function value(t){
 switch(t){
 case 0:return null;case 1:case 2:case 3:case 0x87:return u8();case 4:case 5:return u16();case 6:case 7:return u32();case 8:case 9:case 0x12:{const h=b.readBigUInt64LE(o);o+=8;return name(h)}
 case 10:{const v=b.readFloatLE(o);o+=4;return v}case 11:case 12:case 13:case 14:{const n=t===14?16:t-9;return Array.from({length:n},()=>value(10))}case 15:return Array.from({length:4},u8);
 case 16:return str();case 17:case 0x84:return name(u32());
 case 0x80:case 0x81:{const t=u8(),size=u32(),n=u32();return Array.from({length:n},()=>value(t));}
 case 0x82:case 0x83:{const cls=u32();if(!cls)return null;const len=u32();return {_type:name(cls),...fields()};}
 case 0x85:{const t=u8(),n=u8();return Array.from({length:n},()=>value(t));}
 case 0x86:{const kt=u8(),vt=u8(),len=u32(),n=u32(),m={};for(let i=0;i<n;i++)m[value(kt)]=value(vt);return m;}
 default:throw new Error('unknown type '+t+' at '+o);
 }
}
const version=u32(),links=[];if(version>=2){const n=u32();for(let i=0;i<n;i++)links.push(str());}const n=u32(),types=Array.from({length:n},()=>name(u32())),entries=[];
for(let i=0;i<n;i++){const length=u32(),start=o,id=name(u32());try {entries.push({id,type:types[i],...fields()});} catch(e) {entries.push({id,type:types[i],error:e.message});} o=start+length;}
console.log(JSON.stringify({version,links,entries},null,2));

