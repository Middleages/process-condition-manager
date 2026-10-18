// MOCKED backend fixture; no database or server verification.
const PROJECT_ID = 42
const LAYER_A = 'L1::HISTORY::010::ETCH'
const LAYER_B = 'L1::HISTORY::020::CLEAN'
const LONG_ACTOR = `operator_${'x'.repeat(88)}`
const LONG_PARAMETER = 'gas_flow_rate_with_extended_identifier_for_history_verification'
const LONG_OLD_CODE = `old_code_${'7'.repeat(96)}`
const LONG_NEW_VALUE = `new_value_${'9'.repeat(96)}`
const now = '2026-08-14T05:00:00Z'

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' }
const json = (route, body, status = 200) =>
  route.fulfill({ status, headers: jsonHeaders, body: JSON.stringify(body) })

const profile = {
  project_id: PROJECT_ID,
  process_name: 'History verification process',
  device_type: { code: 'LOGIC', label: 'Logic', is_active: true },
  project_category: { code: 'QA', label: 'Browser QA', is_active: true },
  comment: 'Deterministic history workbench fixture',
  active_direction: null,
  gate_direction: null,
  gross_die: null,
  pitch_x: null,
  pitch_y: null,
  shot_x: null,
  shot_y: null,
  slit_occupancy: null,
  lens_occupancy: null,
  map_offset_x: null,
  map_offset_y: null,
  scribe_lane_x: null,
  scribe_lane_y: null,
  shot_count: null,
  full_shot: null,
  layer_total: '2',
  euv: null,
  imm: null,
  arf: null,
  krf: null,
  iline: null,
  soh: null,
  pspi: null,
  metal_layer_count: null,
  created_at: now,
  updated_at: now,
}

const layers = [
  {
    id: 4201,
    layer_key: LAYER_A,
    step_seq: '010',
    layer_id: 'ETCH',
    eqp_type: 'ETCHER',
    eqp_type_desc: 'Etcher',
    area_name: 'FAB-A',
    sort_order: 1,
    condition_count: 1,
    cell_count: 4,
    source_project_id: null,
    source_layer_key: null,
  },
  {
    id: 4202,
    layer_key: LAYER_B,
    step_seq: '020',
    layer_id: 'CLEAN',
    eqp_type: 'WET',
    eqp_type_desc: 'Wet clean',
    area_name: 'FAB-B',
    sort_order: 2,
    condition_count: 1,
    cell_count: 4,
    source_project_id: null,
    source_layer_key: null,
  },
]

const project = {
  id: PROJECT_ID,
  line_id: 'L1',
  process_id: 'HISTORY',
  part_id: 'PART-HISTORY-QA',
  name: 'Signal Grid History Workbench QA',
  status: 'draft',
  version: 3,
  revision_root_id: PROJECT_ID,
  predecessor_project_id: null,
  successor_project_id: null,
  allowed_actions: ['request_review'],
  profile,
  layers,
}

function column(parameterCode, displayName, sortOrder, unit = null) {
  return {
    parameter_code: parameterCode,
    display_name: displayName,
    value_type: 'number',
    category_code: 'process',
    unit,
    min_value: '0',
    max_value: '1000',
    required: false,
    pattern: null,
    pattern_hint: null,
    description: `Browser fixture ${displayName}`,
    choice_set_code: null,
    choice_set_version: null,
    sort_order: sortOrder,
  }
}

const sheet = {
  columns: [
    column('pressure', 'Pressure', 1, 'mTorr'),
    column(LONG_PARAMETER, 'Gas flow rate with extended identifier', 2, 'sccm'),
    column('temperature', 'Temperature', 3, 'C'),
    column('duration', 'Duration', 4, 's'),
  ],
  rows: [
    {
      condition_id: 101,
      layer_key: LAYER_A,
      step_seq: '010',
      layer_id: 'ETCH',
      layer_label: 'ETCH (010)',
      condition_label: 'POR',
      is_por: true,
      layer_sort_order: 1,
      condition_index: 0,
      cells: {
        pressure: '50.0',
        [LONG_PARAMETER]: '125.000000000000000000000000000000000000000000000000000000000001',
        temperature: '240',
        duration: '60',
      },
    },
    {
      condition_id: 202,
      layer_key: LAYER_B,
      step_seq: '020',
      layer_id: 'CLEAN',
      layer_label: 'CLEAN (020)',
      condition_label: 'POR',
      is_por: true,
      layer_sort_order: 2,
      condition_index: 0,
      cells: {
        pressure: '25.0',
        [LONG_PARAMETER]: '250',
        temperature: '80',
        duration: '90',
      },
    },
  ],
  lock: {
    locked_by: null,
    locked_at: null,
    expires_at: null,
    is_mine: false,
    heartbeat_seconds: 45,
  },
  validation_rules: [],
  validation_basis_hash: `sha256:${'a'.repeat(64)}`,
  frozen_choice_sets: [],
}

const jump = (layerKey, conditionId, parameterCode, jumpStatus = 'available') => ({
  layer_key: layerKey,
  condition_id: conditionId,
  parameter_code: parameterCode,
  cell_ref: `${conditionId}:${parameterCode}`,
  jump_status: jumpStatus,
})

function eventItem({
  id,
  summary,
  layerKey = LAYER_A,
  target = jump(LAYER_B, 202, LONG_PARAMETER),
  metadataStatus = 'complete',
}) {
  return {
    kind: 'event',
    cursor_id: id,
    event_types: ['cell_update'],
    actors: [LONG_ACTOR],
    origins: ['manual'],
    started_at: `2026-08-14T04:${String(id).padStart(2, '0')}:00Z`,
    occurred_at: `2026-08-14T04:${String(id).padStart(2, '0')}:00Z`,
    layer_keys: [layerKey],
    source_project_id: null,
    batch_id: null,
    matched_event_count: 1,
    total_event_count: 1,
    summary,
    jump_target: target,
    detail_status: 'not_applicable',
    detail_scope: null,
    metadata_status: metadataStatus,
  }
}

function batchItem({ id, summary, batchId, scope, matched = 2, detailStatus = 'available' }) {
  return {
    kind: 'batch',
    cursor_id: id,
    event_types: ['cell_update'],
    actors: [LONG_ACTOR],
    origins: ['paste'],
    started_at: `2026-08-14T03:${String(id).padStart(2, '0')}:00Z`,
    occurred_at: `2026-08-14T03:${String(id).padStart(2, '0')}:00Z`,
    layer_keys: [LAYER_A],
    source_project_id: 17,
    batch_id: batchId,
    matched_event_count: matched,
    total_event_count: matched,
    summary,
    jump_target: null,
    detail_status: detailStatus,
    detail_scope: detailStatus === 'available' ? scope : null,
    metadata_status: detailStatus === 'legacy_unavailable' ? 'legacy_partial' : 'complete',
  }
}

const ROOT_TIMELINE_ITEMS = [
  eventItem({ id: 9, summary: 'Metrology review recorded' }),
  eventItem({
    id: 8,
    summary: 'Removed condition remains visible in history',
    target: jump(LAYER_A, 999, 'pressure', 'deleted'),
    metadataStatus: 'legacy_partial',
  }),
  batchItem({
    id: 7,
    summary: 'Cached batch detail fixture',
    batchId: 'batch-cache',
    scope: 'scope-cache',
    matched: 3,
  }),
  batchItem({
    id: 6,
    summary: 'Batch detail retry fixture',
    batchId: 'batch-retry',
    scope: 'scope-retry',
    matched: 2,
  }),
  batchItem({
    id: 5,
    summary: 'Legacy batch detail coverage',
    batchId: 'batch-legacy',
    scope: 'scope-legacy',
    matched: 4,
    detailStatus: 'legacy_unavailable',
  }),
]

const coverage = {
  legacy_unresolved_layer_count: 2,
  legacy_detail_unavailable_count: 1,
}

const detailEntry = ({
  id,
  oldCode,
  newCode,
  layerKey = LAYER_A,
  conditionId = 101,
  parameterCode = 'pressure',
}) => ({
  event_id: id,
  old_code: oldCode,
  new_code: newCode,
  copied_value: null,
  choice_label: null,
  actor: LONG_ACTOR,
  origin: 'paste',
  created_at: `2026-08-14T02:${String(id).padStart(2, '0')}:00Z`,
  layer_key: layerKey,
  jump_target: jump(layerKey, conditionId, parameterCode),
  domain_coordinate: {
    layer_key: layerKey,
    condition_id: conditionId,
    parameter_code: parameterCode,
    cell_ref: `${conditionId}:${parameterCode}`,
  },
  capture_tuple: {
    target_layer_sort: layerKey === LAYER_A ? 1 : 2,
    target_layer_key: layerKey,
    source_condition_index: 0,
    source_condition_id: conditionId,
    parameter_sort: 1,
    parameter_code: parameterCode,
    event_id: id,
  },
  metadata_status: 'complete',
})

const cellHistory = {
  items: [
    {
      event_id: 902,
      old_code: LONG_OLD_CODE,
      new_code: LONG_NEW_VALUE,
      choice_label: null,
      actor: LONG_ACTOR,
      origin: 'manual',
      created_at: '2026-08-14T04:10:00Z',
      layer_key: LAYER_A,
      jump_status: 'available',
      metadata_status: 'complete',
    },
    {
      event_id: 901,
      old_code: '48.0',
      new_code: '50.0',
      choice_label: null,
      actor: LONG_ACTOR,
      origin: 'manual',
      created_at: '2026-08-14T04:09:00Z',
      layer_key: LAYER_A,
      jump_status: 'available',
      metadata_status: 'complete',
    },
    {
      event_id: 900,
      old_code: '47.5',
      new_code: '48.0',
      choice_label: null,
      actor: null,
      origin: 'system',
      created_at: '2026-08-13T23:00:00Z',
      layer_key: LAYER_A,
      jump_status: 'deleted',
      metadata_status: 'legacy_partial',
    },
  ],
  baseline_entry: { code: '45.0', label: null },
  initial_entry: { code: '47.5', label: null },
  initial_state_unavailable: false,
  next_cursor: null,
}


export { PROJECT_ID, LAYER_A, LAYER_B, LONG_PARAMETER };

export function createFixture({status='draft',empty=false,sheetErrors=0,projectErrors=0,readonly=false,releaseDelayMs=0,releaseFailures=0}={}) {
 const p=structuredClone(project); p.status=status; p.name='Internal fixture name'; p.process_id='HISTORY';
 p.allowed_actions=status==='draft'?['request_review']:status==='approved'?['create_revision']:[];
 p.created_at=now;p.updated_at=now;
 const sh=structuredClone(sheet);sh.rows[0].cells[LONG_PARAMETER]='125';sh.columns[1].display_name='Gas flow';
 if(empty){p.layers=[];sh.rows=[];}
 return {project:p,sheet:sh,readonly,sheetErrors,projectErrors,held:null,generation:0,releaseDelayMs,releaseFailures,network:[],unexpected:[],lockEvents:[],cellSaves:[],profileSaves:[]};
}

export function dispatch(state,method,input,body=null,headers={}) {
 const url=new URL(input,'http://fixture.test'); const pathname=url.pathname.replace(/^\/api/,'');
 const response=(body,status=200)=>({body:structuredClone(body),status});
 const conflict=(message)=>response({code:'lock_conflict',message},409);
 const token=headers['x-lock-token']??body?.lock_token;
 state.network.push({method,pathname,search:url.search,body,token});
 if(method==='GET' && pathname==='/auth/me')return response({id:'oidc:history-browser-qa',display_name:'Workspace QA',email:'qa@example.test',roles:state.readonly?['viewer']:['admin','reviewer','editor'],permissions:state.readonly?['business.read']:['business.read','project.edit','project.comment','project.review.request','project.review.decide','project.revision.create']});
 if(method==='GET' && pathname==='/projects/lines')return response(['L1','L2']);
 if(method==='GET' && pathname==='/projects')return response({items:url.searchParams.get('line_id')==='L2'?[]:[state.project],next_cursor:null});
 if(method==='GET' && pathname==='/projects/42'){
  if(state.projectErrors-->0)return response({code:'qa_project_failure',message:'Fixture project unavailable'},503);
  return response(state.project);
 }
 if(method==='GET' && pathname==='/projects/42/sheet'){
  if(state.sheetErrors-->0)return response({code:'qa_sheet_failure',message:'Fixture sheet unavailable'},503);
  return response(state.sheet);
 }
 if(method==='GET' && pathname==='/projects/42/profile')return response(state.project.profile);
 if(method==='GET' && /^\/choice-sets\/[^/]+$/.test(pathname)){const code=pathname.split('/')[2];return response({code,display_name:code,description:null,is_active:true,version:1,option_count:1,active_option_count:1,parameter_usage_count:0,profile_usage_fields:[],created_at:now,updated_at:now});}
 if(method==='GET' && /^\/choice-sets\/[^/]+\/options$/.test(pathname)){
  const set_code=pathname.split('/')[2];const code=set_code==='device_type'?'LOGIC':set_code==='project_category'?'QA':'FORWARD';
  return response({set_code,version:1,items:[{code,label:code,sort_order:1,is_active:true}],next_cursor:null});
 }
 if(pathname==='/projects/42/lock' && method==='POST'){
  if(state.held){state.lockEvents.push({kind:'duplicate-acquire',held:state.held});return conflict('Duplicate lock acquisition rejected by strict QA fixture');}
  if(state.readonly||!['draft','rejected'].includes(state.project.status))return conflict('Read-only fixture');
  state.held=`fixture-token-${++state.generation}`;state.lockEvents.push({kind:'acquire',token:state.held});
  return response({locked_by:'oidc:history-browser-qa',lock_token:state.held,locked_at:now,expires_at:'2099-01-01T00:00:00Z'});
 }
 if((pathname==='/projects/42/lock'&&method==='DELETE')||(pathname==='/projects/42/lock/release'&&method==='POST')){
  if(state.releaseFailures>0){state.releaseFailures--;state.lockEvents.push({kind:'release-failed',token});return response({code:'qa_release_failure',message:'Fixture release failed; lock remains held'},503);}
  if(!state.held||token!==state.held){state.lockEvents.push({kind:'stale-release',token,held:state.held});return conflict('Release token mismatch');}
  state.lockEvents.push({kind:'release',token});state.held=null;return response(null,204);
 }
 if(pathname==='/projects/42/lock/heartbeat'&&method==='POST'){
  if(!state.held||token!==state.held)return conflict('Heartbeat token mismatch');
  state.lockEvents.push({kind:'heartbeat',token});return response({locked_by:'oidc:history-browser-qa',lock_token:token,locked_at:now,expires_at:'2099-01-01T00:00:00Z'});
 }
 if(method==='PATCH'&&['/projects/42/profile','/projects/42/cells'].includes(pathname)){
  if(!state.held||token!==state.held){state.lockEvents.push({kind:'stale-write',pathname,token});return conflict('Write token mismatch');}
  if(pathname.endsWith('/profile')){
   state.profileSaves.push({body:structuredClone(body),token});Object.assign(state.project.profile,body);
   return response(state.project.profile);
  }
  for(const cell of body.cells){
   const row=state.sheet.rows.find(r=>r.condition_id===cell.condition_id);
   if(!row||!(cell.parameter_code in row.cells))return response({code:'qa_unknown_cell',message:'Unknown fixture coordinate'},422);
   row.cells[cell.parameter_code]=cell.value;
  }
  state.cellSaves.push({body:structuredClone(body),origin:body.origin,token});return response({cells:body.cells,batch_id:`qa-save-${state.cellSaves.length}`});
 }
 if(method==='GET'&&pathname==='/projects/42/comments')return response({items:[],next_cursor:null});
 if(method==='GET'&&pathname==='/projects/42/events')return response({items:[eventItem({id:9,summary:'Pressure updated on ETCH',layerKey:LAYER_A,target:jump(LAYER_A,101,'pressure')}),eventItem({id:8,summary:'Pressure updated on CLEAN',layerKey:LAYER_B,target:jump(LAYER_B,202,'pressure')})].filter(item=>!url.searchParams.get('layer_key')||item.layer_keys.includes(url.searchParams.get('layer_key'))),coverage:{legacy_unresolved_layer_count:0,legacy_detail_unavailable_count:0},next_cursor:null});
 if(method==='GET'&&pathname==='/projects/42/cell-history')return response(cellHistory);
 state.unexpected.push({method,pathname,search:url.search});return response({code:'qa_unmocked',message:`${method} ${pathname}`},500);
}

export async function installFixture(page,state){
 await page.route('**/api/**',async route=>{
  const request=route.request(); if(!new URL(request.url()).pathname.startsWith('/api/'))return route.continue(); let body=null;
  try {body=request.postDataJSON();}catch {body=request.postData();}
  if(state.releaseDelayMs && (request.method()==='DELETE' && new URL(request.url()).pathname.endsWith('/lock') || new URL(request.url()).pathname.endsWith('/lock/release'))){
   state.lockEvents.push({kind:'release-pending',token:body?.lock_token});
   await new Promise(resolve=>setTimeout(resolve,state.releaseDelayMs));
  }
  const result=dispatch(state,request.method(),request.url(),body,request.headers());
  await route.fulfill({status:result.status,headers:jsonHeaders,body:result.status===204?'':JSON.stringify(result.body)});
 });
}
