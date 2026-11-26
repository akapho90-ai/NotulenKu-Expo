const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {test} = require('node:test');
const ts = require('typescript');

function loadService(name, imports) {
 const source = readFileSync(join(__dirname,'../src/services',name+'.ts'),'utf8');
 const {outputText} = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}});
 const module = {exports:{}};
 new Function('require','module','exports',outputText)(name => {
  assert.ok(Object.hasOwn(imports,name),'Unexpected import '+name);
  return imports[name];
 },module,module.exports);
 return module.exports;
}

function openDb() {
 const sql = new DatabaseSync(':memory:');
 return {
  execSync: text => sql.exec(text),
  runSync: (text,...args) => sql.prepare(text).run(...args),
  getAllSync: (text,...args) => sql.prepare(text).all(...args),
  getFirstSync: (text,...args) => sql.prepare(text).get(...args) ?? null,
  withTransactionSync(work) {
   sql.exec('BEGIN');
   try {
    work();
    sql.exec('COMMIT');
   } catch (failure) {
    sql.exec('ROLLBACK');
    throw failure;
   }
  },
 };
}

const startedAt = 1_700_000_000_000;
function checkpoint(sessionId, status = 'recorded') {
 return {
  sessionId,startedAt,status,active:status === 'recording',segmentSeconds:180,
  segments:JSON.stringify([0,1].map(index => ({
   index,path:'/local/'+sessionId+'/segment_'+index+'.m4a',
   startedAtMs:startedAt+index*181_000,endedAtMs:startedAt+index*181_000+180_000,
   offsetMs:index*181_000,
  }))),
 };
}

test('recovery is idempotent, preserves live session, and marks interrupted rows', () => {
 const db = openDb();
 const store = loadService('db',{'expo-sqlite':{openDatabaseSync:()=>db}});
 store.initializeDb();
 for (let pass=0;pass<2;pass++) {
  store.syncRecording(checkpoint('live','recording'),true);
  store.syncRecording(checkpoint('lost','recording'),true);
  store.reconcileInactiveSessions('live');
 }
 assert.equal(store.listSegments('lost').length,2);
 assert.equal(store.listSegments('live')[1].startOffsetMs,181_000);
 assert.equal(store.listSessions().find(row=>row.id==='live').endedAt,null);
 assert.equal(store.listSessions().find(row=>row.id==='lost').status,'interrupted');
 const missing = checkpoint('lost','interrupted');
 const segments = JSON.parse(missing.segments);
 delete segments[1].path;
 missing.segments = JSON.stringify(segments);
 store.syncRecording(missing,true);
 assert.equal(store.listSegments('lost')[1].status,'missing_file');
 store.syncRecording(checkpoint('lost'),true);
 assert.equal(store.listSegments('lost')[1].status,'saved');
});

test('upgrades old SQLite, restores prior transcript lines and requeues interrupted claims', () => {
 const db = openDb();
 db.execSync(`CREATE TABLE segments(id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, sequence INTEGER NOT NULL,
  started_at TEXT NOT NULL, ended_at TEXT, uri TEXT, status TEXT NOT NULL, duration_ms INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT, transcript TEXT, transcript_offset_ms INTEGER, UNIQUE(session_id,sequence));`);
 const store = loadService('db',{'expo-sqlite':{openDatabaseSync:()=>db}});
 store.initializeDb();
 store.syncRecording(checkpoint('previous'),true);
 const [first,second] = store.listSegments('previous');
 db.runSync("UPDATE segments SET status='completed',transcript='prior',transcript_offset_ms=0 WHERE id=?", second.id);
 assert.equal(store.claimSegment('previous',first.id),true);
 store.initializeDb();
 store.initializeDb();
 store.syncRecording(checkpoint('previous'),true);
 assert.equal(store.listSegments('previous')[0].status,'failed');
 assert.equal(store.listSegments('previous')[0].attempts,1);
 assert.equal(store.getTranscript('previous').length,1);
 assert.equal(store.getTranscript('previous')[0].offsetMs,181_000);
});

test('transcript and line replacement roll back together and are claimed once', () => {
 const db = openDb();
 const store = loadService('db',{'expo-sqlite':{openDatabaseSync:()=>db}});
 store.initializeDb();
 store.syncRecording(checkpoint('meeting'));
 const [,segment] = store.listSegments('meeting');
 assert.equal(store.claimSegment('other',segment.id),false);
 assert.equal(store.claimSegment('meeting',segment.id),true);
 assert.equal(store.claimSegment('meeting',segment.id),false);
 db.execSync("CREATE TRIGGER reject_line BEFORE INSERT ON transcript_lines BEGIN SELECT RAISE(ABORT,'line failed'); END;");
 assert.throws(()=>store.completeSegment('meeting',segment.id,'phrase',181_000,[{speaker:'A',text:'phrase',offsetMs:100}]),/line failed/);
 assert.equal(store.listSegments('meeting')[1].status,'processing');
 assert.equal(store.getTranscript('meeting').length,0);
 db.execSync('DROP TRIGGER reject_line');
 store.completeSegment('meeting',segment.id,'phrase',181_000,[{speaker:'A',text:'phrase',offsetMs:100}]);
 store.completeSegment('meeting',segment.id,'duplicate',0,[{speaker:'B',text:'duplicate',offsetMs:0}]);
 assert.deepEqual(store.getTranscript('meeting').map(row=>({...row})),[{offsetMs:181100,speaker:'A',text:'phrase'}]);
});

test('STT retries transport failures, validates responses and keeps the native offset', async t => {
 const db = openDb();
 const store = loadService('db',{'expo-sqlite':{openDatabaseSync:()=>db}});
 store.initializeDb();
 store.syncRecording(checkpoint('meeting'));
 const env = process.env.EXPO_PUBLIC_NOTULENKU_API_URL;
 process.env.EXPO_PUBLIC_NOTULENKU_API_URL = 'https://example.test';
 const originals = {fetch:global.fetch,FormData:global.FormData};
 t.after(()=>{
  Object.assign(global,originals);
  if (env === undefined) delete process.env.EXPO_PUBLIC_NOTULENKU_API_URL;
  else process.env.EXPO_PUBLIC_NOTULENKU_API_URL = env;
 });
 global.FormData = class extends Map {append(key,value){this.set(key,value);}};
 let attempts = 0;
 global.fetch = async (_url,{body,signal}) => {
  attempts++;
  assert.equal(body.get('audio').uri,'file:///local/meeting/segment_1.m4a');
  assert.equal(body.get('offset_ms'),'181000');
  assert.equal(signal.aborted,false);
  if (attempts === 1) throw new Error('offline');
  if (attempts === 2) return Response.json({text:null});
  return Response.json({text:'phrase',offsetMs:0,lines:[{speaker:'A',text:'phrase',offsetMs:50}]});
 };
 const {transcribePending} = loadService('transcription',{
  './db':store,
  'expo-file-system':{File:class {constructor(uri){this.uri=uri;this.exists=true;this.size=5;}}},
 });
 for (let i=0;i<4;i++) await transcribePending('meeting',[store.listSegments('meeting')[1]]);
 assert.equal(attempts,3);
 assert.equal(store.listSegments('meeting')[1].attempts,3);
 assert.deepEqual(store.getTranscript('meeting').map(row=>({...row})),[{offsetMs:181050,speaker:'A',text:'phrase'}]);
});

test('tracked Android project declares a private microphone service and resolves its Expo module', () => {
 const root = join(__dirname,'..');
 const manifest = readFileSync(join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
 const packageName = 'expo.modules.notulenkurecorder';
 const service = manifest.match(/<service\b[^>]*android:name="expo\.modules\.notulenkurecorder\.NotulenKuRecordingService"[^>]*>/)?.[0];
 assert.ok(service);
 assert.match(service,/android:exported="false"/);
 assert.match(service,/android:foregroundServiceType="microphone"/);
 for (const permission of ['RECORD_AUDIO','FOREGROUND_SERVICE','FOREGROUND_SERVICE_MICROPHONE']) {
  assert.ok(manifest.includes('android:name="android.permission.'+permission+'"'));
 }
 const {execFileSync} = require('node:child_process');
 const cli = join(root,'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js');
 const result = JSON.parse(execFileSync(process.execPath,[cli,'resolve','--platform','android','--json'],{cwd:root,encoding:'utf8'}));
 const recorder = result.modules.find(entry=>entry.packageName==='notulenku-recorder');
 assert.ok(recorder?.projects.some(project=>project.modules.includes(packageName+'.NotulenKuRecorderModule')));
});
