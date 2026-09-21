// Run from any directory. Executes the website's unmodified analysis functions
// in an isolated Node VM to produce independently derived native test fixtures.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
process.env.TZ='UTC';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.join(root,'android/core/src/test/resources');
fs.mkdirSync(output,{recursive:true});
const context=vm.createContext({console:{log(){},warn(){},error(){}},Map,Set,Date,Intl,GLOBAL_BASE_SETTING_IDS:new Set(),SCROBBLE_SORT_ASC:'earliest-to-latest',SCROBBLE_SORT_DESC:'latest-to-earliest'});
for(const file of ['js/state.js','js/time.js','js/data/metrics.js','js/data/filters.js']) {
  const source=fs.readFileSync(path.join(root,file),'utf8').replace(/^import[\s\S]*?;\s*$/gm,'').replace(/\bexport /g,'');
  vm.runInContext(source,context,{filename:file});
}
const rows=[];
for(let i=0;i<160;i++) {
  const artist=['Alpha','Beta','Gamma'][i%3];
  const track=['One','Two','Three','Four'][i%4];
  rows.push({Artist:artist,Album:artist+' Album',Track:track,Date:String(Date.UTC(2024,11,20)+Math.floor(i/3)*18*3600000+(i%3)*1800000),order:i+1});
}
context.input=rows;
vm.runInContext(`state.allTracks=input;for(const type of ['artist','album','track']) {const key=s=>type==='artist'?s.Artist.toLowerCase():((type==='album'?s.Album:s.Track)+'||'+s.Artist).toLowerCase();const groups=Object.groupBy(input,key);for(const [key,plays] of Object.entries(groups)) state[type+'DataMap'][key]={user_scrobbles:plays.length,playcount:10000,listeners:1000,duration:180000};}`,context);
fs.writeFileSync(path.join(output,'website-history.tsv'),rows.map(s=>[s.Artist,s.Album,s.Track,s.Date].join('\t')).join('\n'));
const sorts=['scrobbles','separate-days','separate-weeks','separate-months','consecutive-scrobbles','consecutive-days','consecutive-weeks','consecutive-months','first-n-scrobbles','fastest-n-scrobbles','oldest-average-listening-time','newest-average-listening-time','max-single-day','max-single-week','max-single-month','max-rolling-xh','max-rolling-24h','max-rolling-168h','time-spent-listening','highest-listening-percentage'];
const lines=[];
for(const type of ['artist','album','track']) for(const sort of sorts) {
  context.kind=type;context.sort=sort;
  const result=vm.runInContext('buildEntitiesFromTracks(state.allTracks,kind,sort,3)',context);
  for(const row of result) {
    const title=type==='track'?row.Track:row.name;
    const artist=type==='artist'?'':(row.Artist || row.artist);
    const value=row.count ?? row.maxConsecutive ?? row.listeningPercentage ?? row.listeningDuration ?? row.dateReached ?? row.timeNeeded ?? row.averageListeningTimestamp;
    const metric=sort==='time-spent-listening'?row.listeningDuration:sort==='highest-listening-percentage'?row.listeningPercentage:sort==='first-n-scrobbles'?row.dateReached:sort==='fastest-n-scrobbles'?row.timeNeeded:sort.endsWith('average-listening-time')?row.averageListeningTimestamp:sort.startsWith('consecutive-')?row.maxConsecutive:value;
    lines.push([type,sort,title,artist,metric].join('\t'));
  }
}
fs.writeFileSync(path.join(output,'website-results.tsv'),lines.join('\n'));
console.log(`Generated ${lines.length} expected rows across ${sorts.length*3} website queries.`);
