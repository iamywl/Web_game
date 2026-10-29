// Reuse the existing shipped-BIN decoder while loading its hash dictionary once.
const fs=require('node:fs'),path=require('node:path');
const decoder=path.resolve(__dirname,'../../unit-work/turrets/inspect-bin.js');
const source=fs.readFileSync(decoder,'utf8'),cut=source.indexOf('const b=fs.readFileSync(process.argv[2])');
if(cut<0)throw new Error('Unexpected existing BIN decoder layout');
const {names,sourceFs}=new Function('require','__dirname',source.slice(0,cut)+';return {names,sourceFs:fs};')(require,path.dirname(decoder));
const body=source.slice(cut).replace('process.argv[2]','sourcePath')
 .replace("entries.push({id,type:types[i],...fields()});if(o!==start+length)throw new Error('length mismatch '+o+' '+(start+length));", "try { const entry={id,type:types[i],...fields()}; if(o!==start+length)throw new Error('length mismatch'); entries.push(entry); } catch(error) { entries.push({id,type:types[i],error:error.message}); o=start+length; }")
 .replace('console.log(JSON.stringify({version,links,entries},null,2));','return {version,links,entries};');
const parse=new Function('names','fs','sourcePath',body),result={};
for(const file of process.argv.slice(2)){
  try{result[file]=parse(names,sourceFs,file);}catch(error){result[file]={error:error.message};}
}
process.stdout.write(JSON.stringify(result));
