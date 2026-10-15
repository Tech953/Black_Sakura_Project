"""Transactional restore of reference packs, with byte-preserved originals."""
from pathlib import Path, PurePosixPath
import copy, hashlib, json, re, shutil, stat, tempfile, zipfile
from . import audio, research
from .engine import identifier, now, write_json
from full_rezz_bridge import ReferencePack

def safe_name(name):
 if not isinstance(name,str) or not name or '\\' in name or ':' in name or '//' in name or re.search(r'[\x00-\x1f]',name):raise ValueError('Unsafe ZIP path.')
 p=PurePosixPath(name)
 if p.is_absolute() or any(x in ('..','.') or x.endswith((' ','.')) or re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?',x,re.I) for x in name.rstrip('/').split('/')):raise ValueError('Unsafe ZIP path.')
 return p

def preview_archive(studio,archive):
 archive=Path(archive)
 with tempfile.TemporaryDirectory(dir=studio.root) as temp:
  root=Path(temp)
  with zipfile.ZipFile(archive) as z:
   infos=z.infolist()
   if len(infos)>10000 or sum(i.file_size for i in infos)>512*1024**2:raise ValueError('Pack exceeds 512 MiB expanded or 10,000 files.')
   seen=set()
   for i in infos:
    p=safe_name(i.filename);key=str(p).casefold()
    if key in seen or stat.S_ISLNK(i.external_attr>>16):raise ValueError('Duplicate or symbolic ZIP path.')
    seen.add(key)
    if i.is_dir():continue
    target=root.joinpath(*p.parts);target.parent.mkdir(parents=True,exist_ok=True)
    with z.open(i) as src,target.open('wb') as out:shutil.copyfileobj(src,out)
  candidates=[]
  for m in root.rglob('manifest.json'):
   try:value=json.loads(m.read_text(encoding='utf-8'))
   except (ValueError,UnicodeError):continue
   if value.get('schema_version') in ('1.0.0','1.1.0') and isinstance(value.get('profiles'),list):candidates.append((m,value))
  active=[c for c in candidates if c[0].parent.name=='reference_pack' or c[0].parent==root]
  chosen=active or candidates
  if len(chosen)!=1:raise ValueError('Choose a ZIP with one active reference pack.')
  manifest_path,manifest=chosen[0];pack=ReferencePack(manifest_path.parent)
  if pack.manifest_sha256!=hashlib.sha256(manifest_path.read_bytes()).hexdigest():raise ValueError('Reference-pack manifest changed during validation.')
  profiles=[]
  for profile_id in pack.profile_ids:
   profile=pack.profile(profile_id)
   profiles.append({'id':profile_id,'name':profile['name'],
                    'reference_count':len(profile['references']),
                    'source_count':len(profile['sources']),
                    'character':copy.deepcopy(profile['character'])})
  return {'pack_id':manifest['pack_id'],'schema_version':manifest['schema_version'],
          'manifest_sha256':pack.manifest_sha256,'profile_count':len(profiles),
          'profiles':profiles,'expanded_file_count':len(infos)}

def restore(studio,archive,include_bridge_contexts=False):
 archive=Path(archive);created_records=[];created_sources=[];import_dir=None
 with tempfile.TemporaryDirectory(dir=studio.root) as temp:
  root=Path(temp)
  with zipfile.ZipFile(archive) as z:
   infos=z.infolist()
   if len(infos)>10000 or sum(i.file_size for i in infos)>512*1024**2:raise ValueError('Pack exceeds 512 MiB expanded or 10,000 files.')
   seen=set()
   for i in infos:
    p=safe_name(i.filename);key=str(p).casefold()
    if key in seen or stat.S_ISLNK(i.external_attr>>16):raise ValueError('Duplicate or symbolic ZIP path.')
    seen.add(key)
    if i.is_dir():continue
    target=root.joinpath(*p.parts);target.parent.mkdir(parents=True,exist_ok=True)
    with z.open(i) as src,target.open('wb') as out:shutil.copyfileobj(src,out)
  candidates=[]
  for m in root.rglob('manifest.json'):
   try:value=json.loads(m.read_text(encoding='utf-8'))
   except (ValueError,UnicodeError):continue
   if value.get('schema_version') in ('1.0.0','1.1.0') and isinstance(value.get('profiles'),list):candidates.append((m,value))
  active=[c for c in candidates if c[0].parent.name=='reference_pack' or c[0].parent==root]
  chosen=active or candidates
  if len(chosen)!=1:raise ValueError('Choose a ZIP with one active reference pack.')
  m,manifest=chosen[0];base=m.parent;profiles=manifest['profiles']
  # Apply the published bridge validator to the safely extracted pack. The
  # transaction below still owns import/remapping and byte-preserved recovery.
  bridge_pack=ReferencePack(base)
  if bridge_pack.manifest_sha256!=hashlib.sha256(m.read_bytes()).hexdigest():
   raise ValueError('Reference-pack manifest changed during validation.')
  if not 1<=len(profiles)<=100:raise ValueError('Pack must contain 1–100 profiles.')
  ids=[p.get('id') for p in profiles]
  if any(not isinstance(x,str) or not re.fullmatch(r'voice_[a-f0-9]{16}',x) for x in ids) or len(set(ids))!=len(ids):raise ValueError('Invalid or duplicate profile identifiers.')
  def checked(path,sha=None):
   p=safe_name(path);target=base.joinpath(*p.parts).resolve()
   if not target.is_relative_to(base) or not target.is_file():raise ValueError('Missing or unsafe reference file.')
   if sha and hashlib.sha256(target.read_bytes()).hexdigest()!=sha:raise ValueError('Reference integrity checksum failed.')
   return target
  sources={}
  for p in profiles:
   if not isinstance(p.get('name'),str) or not 1<=len(p['name'])<=100:raise ValueError('Invalid profile name.')
   research.validate_character(p.get('character',{}),{s['id'] for s in p.get('sources',[])})
   for ref in p.get('references',[]):checked(ref['path'],ref.get('sha256'))
   for s in p.get('sources',[]):
    sid=s['id']
    if not re.fullmatch(r'src_[a-f0-9]{16}',sid):raise ValueError('Invalid source identifier.')
    checked(s['text_path'],s.get('text_sha256'))
    if s.get('original_path'):checked(s['original_path'],s.get('original_sha256'))
    if sid in sources and sources[sid]!=s:raise ValueError('Conflicting source identifiers.')
    sources[sid]=s
  mapping={old:identifier('voice') for old in ids};mapping.update({sid:identifier('src') for sid in sources})
  def remap(value):
   if isinstance(value,dict):return {k:remap(v) for k,v in value.items()}
   if isinstance(value,list):return [remap(v) for v in value]
   if isinstance(value,str):
    if value in mapping:return mapping[value]
    for old,new in mapping.items():
     if value.startswith('sources/'+old+'/'):return value.replace('sources/'+old+'/', 'sources/'+new+'/',1)
   return value
  with studio.lock:
   original=studio.profiles();iid=identifier('import');import_dir=studio.root/'original_imports'/iid
   try:
    for old,s in sources.items():
     target=studio.sources_dir/mapping[old];target.mkdir();created_sources.append(target)
     for key in ('text_path','original_path'):
      if s.get(key):shutil.copy2(checked(s[key]),target/Path(s[key]).name)
     write_json(target/'source.json',remap(s))
    imported=[]
    for p in profiles:
     q=remap(copy.deepcopy(p));q.pop('references',None);q['historical_embeddings']=q.pop('embeddings',[]);q['revision']=0;q['imported_at']=now();q['portable_imports']=[iid];imported.append(q)
    write_json(studio.profiles_file,original+imported)
    for p in profiles:
     for ref in p.get('references',[]):
      record=studio.import_audio(checked(ref['path']),p['name']+' — imported reference',origin={'kind':'portable_pack','import_id':iid,'original_profile_id':p['id'],'original_reference':ref,'original_recording_id':ref.get('recording_id')});created_records.append(record['id'])
      purity=ref.get('review_status','unreviewed')
      if purity not in ('unreviewed','user_declared_single_voice','model_nonoverlap','reviewed_single_voice'):purity='unreviewed'
      record=studio.save_segments(record['id'],[{'start':0,'end':record['duration'],'speaker':'VOICE_01','channel':None,'purity':purity,'style':ref.get('style','neutral'),'text':ref.get('text','')}])
      studio.bind(record['id'],'VOICE_01',mapping[p['id']])
    import_dir.mkdir(parents=True);shutil.copy2(archive,import_dir/'original.zip')
    receipt={'import_id':iid,'created_at':now(),'archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'manifest_path':m.relative_to(root).as_posix(),'identifier_mapping':mapping,'profile_ids':[mapping[x] for x in ids],'recording_ids':created_records,'preserved_file_count':len(infos)}
    write_json(import_dir/'receipt.json',receipt)
    if include_bridge_contexts:
     imported_profiles={profile_id:studio.profile(mapping[profile_id]) for profile_id in ids}
     return {'receipt':receipt,
             'bridge_contexts':{profile_id:bridge_pack.to_engram(profile_id) for profile_id in ids},
             'imported_profiles':imported_profiles}
    return receipt
   except Exception:
    write_json(studio.profiles_file,original)
    for rid in created_records:shutil.rmtree(studio.records_dir/rid,ignore_errors=True)
    for path in created_sources:shutil.rmtree(path,ignore_errors=True)
    if import_dir:shutil.rmtree(import_dir,ignore_errors=True)
    raise

def rollback_import(studio,import_id):
 if not isinstance(import_id,str) or not re.fullmatch(r'import_[a-f0-9]{32}',import_id):
  raise ValueError('Invalid portable-import identifier.')
 folder=studio.root/'original_imports'/import_id
 receipt_path=folder/'receipt.json'
 if not receipt_path.is_file():raise ValueError('Portable import not found.')
 receipt=json.loads(receipt_path.read_text(encoding='utf-8'))
 if receipt.get('import_id')!=import_id:raise ValueError('Portable-import receipt does not match.')
 mapping=receipt.get('identifier_mapping',{})
 if not isinstance(mapping,dict):raise ValueError('Portable-import receipt has no identifier mapping.')
 profile_ids={value for value in mapping.values() if isinstance(value,str) and value.startswith('voice_')}
 source_ids={value for value in mapping.values() if isinstance(value,str) and value.startswith('src_')}
 with studio.lock:
  original=studio.profiles()
  kept=[profile for profile in original if import_id not in profile.get('portable_imports',[])]
  if len(kept)==len(original):raise ValueError('No imported profiles match this rollback receipt.')
  write_json(studio.profiles_file,kept)
  for source_id in source_ids:shutil.rmtree(studio.sources_dir/source_id,ignore_errors=True)
  for recording_id in receipt.get('recording_ids',[]):
   if isinstance(recording_id,str) and re.fullmatch(r'rec_[a-f0-9]{16}',recording_id):
    shutil.rmtree(studio.records_dir/recording_id,ignore_errors=True)
  shutil.rmtree(folder,ignore_errors=True)
 return {'rolled_back':True,'import_id':import_id,'removed_profile_ids':sorted(profile_ids),
         'removed_recording_count':len(receipt.get('recording_ids',[]))}
