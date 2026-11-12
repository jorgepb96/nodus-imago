import {randomUUID} from 'node:crypto';
import type {Repository} from './db/repository';
import type {AutomationRule,AutomationRun} from '../shared/automations';
import {automationRuleSchema} from '../shared/validation';
export class Automations {
 timer:ReturnType<typeof setInterval>|null=null;
 constructor(public repo:Repository,public analyze:(rowId:string,columnIds:string[])=>string,public changed:()=>void){}
 start(){this.timer=setInterval(()=>{try{this.tick();}catch(error){console.error('[automations]',error);}},1000);this.timer.unref();}
 close(){if(this.timer)clearInterval(this.timer);this.timer=null;}
 list(databaseId:string):AutomationRule[]{this.repo.detail(databaseId);return (this.repo.db.prepare('SELECT config_json FROM automation_rules WHERE database_id=? ORDER BY name,id').all(databaseId) as any[]).map(r=>automationRuleSchema.parse(JSON.parse(r.config_json)) as AutomationRule);}
 save(input:AutomationRule){const rule=automationRuleSchema.parse(input) as AutomationRule,detail=this.repo.detail(rule.databaseId),writable=['title','text','rich_text','number','date','time','select','status','multi_select','checkbox','url','location','ai'];
  const own=(id:string)=>{const c=detail.columns.find(c=>c.id===id);if(!c)throw Error('La propiedad pertenece a otra base de datos.');return c;};
  if(rule.watchColumnId)own(rule.watchColumnId);
  const checkFilters=(items:typeof rule.filters)=>{for(const filter of items)for(const id of filter.columnIds??[filter.columnId])if(!['$created','$modified','$images'].includes(id))own(id);};checkFilters(rule.filters);const checkGroups=(items:NonNullable<AutomationRule['filterGroups']>)=>{for(const group of items){checkFilters(group.filters);checkGroups(group.groups??[]);}};checkGroups(rule.filterGroups??[]);
  for(const action of rule.actions){if(action.kind==='analyze'){action.columnIds.forEach(own);continue;}if(!writable.includes(own(action.columnId).type))throw Error('La automatización no puede escribir en una propiedad calculada, relación o archivo.');if(action.kind==='copy')own(action.sourceColumnId);}
  const existing=this.repo.db.prepare('SELECT database_id FROM automation_rules WHERE id=?').get(rule.id) as any;if(existing&&existing.database_id!==rule.databaseId)throw Error('Regla de otra base de datos.');
  this.repo.db.prepare('INSERT INTO automation_rules(id,database_id,name,enabled,config_json,last_scheduled) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,config_json=excluded.config_json,last_scheduled=excluded.last_scheduled').run(rule.id,rule.databaseId,rule.name,Number(rule.enabled),JSON.stringify(rule),Date.now());
  return rule;
 }
 delete(id:string){this.repo.db.prepare('DELETE FROM automation_rules WHERE id=?').run(id);}
 history(databaseId:string):AutomationRun[]{return this.repo.db.prepare('SELECT x.id,x.rule_id ruleId,x.row_id rowId,x.state,x.message,x.created_at createdAt FROM automation_runs x JOIN automation_rules r ON r.id=x.rule_id WHERE r.database_id=? ORDER BY x.id DESC LIMIT 100').all(databaseId) as AutomationRun[];}
 run(id:string){const r=this.repo.db.prepare('SELECT database_id,enabled FROM automation_rules WHERE id=?').get(id) as any;if(!r||!r.enabled)throw Error('Activa la regla antes de ejecutarla.');return this.repo.db.prepare("INSERT INTO automation_events(row_id,kind,rule_id,created_at) SELECT id,'manual',?,? FROM db_rows WHERE database_id=?").run(id,new Date().toISOString(),r.database_id).changes;}
 tick(){
  const due=this.repo.db.prepare('SELECT id,config_json,last_scheduled FROM automation_rules WHERE enabled=1').all() as any[];
  this.repo.db.transaction(()=>{for(const item of due){const rule=automationRuleSchema.parse(JSON.parse(item.config_json)) as AutomationRule;if(rule.trigger==='schedule'&&Date.now()-item.last_scheduled>=rule.intervalMinutes*60000){this.run(rule.id);this.repo.db.prepare('UPDATE automation_rules SET last_scheduled=? WHERE id=?').run(Date.now(),rule.id);}}})();
  const events=this.repo.db.prepare('SELECT e.*,r.database_id FROM automation_events e JOIN db_rows r ON r.id=e.row_id ORDER BY e.created_at,e.id LIMIT 20').all() as any[];
  for(const event of events){const rules=this.list(event.database_id).filter(r=>r.enabled&&(event.rule_id?r.id===event.rule_id:r.trigger===event.kind&&(!r.watchColumnId||r.watchColumnId===event.column_id)));
   for(const rule of rules){if(this.repo.db.prepare('SELECT 1 FROM automation_runs WHERE event_id=? AND rule_id=?').get(event.id,rule.id))continue;
    let state:'completed'|'skipped'|'failed'='completed',message='';
    try{this.repo.db.transaction(()=>{this.repo.db.prepare('UPDATE automation_control SET muted=1 WHERE id=1').run();try{
      if(!this.repo.literal({databaseIds:[rule.databaseId],filters:rule.filters,filterGroups:rule.filterGroups,filterLogic:rule.filterLogic},[event.row_id]).total){state='skipped';message='Conditions not met';} else {
      for(const action of rule.actions){if(action.kind==='analyze'){const id=this.analyze(event.row_id,action.columnIds);message+=' AI queue: '+id;continue;}
       const row=this.repo.getRow(event.row_id);if(!action.overwrite&&row.cells[action.columnId])continue;
       this.repo.setCell(event.row_id,action.columnId,action.kind==='copy'?row.cells[action.sourceColumnId]??null:action.value);
      }
     }}finally{this.repo.db.prepare('UPDATE automation_control SET muted=0 WHERE id=1').run();}
      this.repo.db.prepare('INSERT INTO automation_runs(rule_id,event_id,row_id,state,message,created_at) VALUES(?,?,?,?,?,?)').run(rule.id,event.id,event.row_id,state,message,new Date().toISOString());
     })();
    }catch(error){state='failed';message=error instanceof Error?error.message:String(error);}
    if(state==='failed')this.repo.db.prepare('INSERT INTO automation_runs(rule_id,event_id,row_id,state,message,created_at) VALUES(?,?,?,?,?,?)').run(rule.id,event.id,event.row_id,state,message,new Date().toISOString());
   }
   this.repo.db.prepare('DELETE FROM automation_events WHERE id=?').run(event.id);
  }
  if(events.length)this.changed();
 }
 static id(){return randomUUID();}
}
