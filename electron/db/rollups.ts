import type {Repository} from './repository';
import {aggregateRollup,ROLLUP_FUNCTIONS,type DatabaseColumn,type DatabaseColumnConfig} from '../../shared/databases';
import {computeFormulas} from '../../shared/databaseFormulaEval';
import {formulaDependencies} from '../../shared/databaseFormula';
import {exportCellText} from '../../shared/databaseExport';
import type {RecordRow} from '../../shared/imago';
export function validateRollup(repo:Repository,databaseId:string,config:DatabaseColumnConfig) {
 const relation=repo.detail(databaseId).columns.find(c=>c.id===config.rollupRelationColumnId&&c.type==='relation');
 if(!relation||!relation.config.relationTargetDatabaseId)throw Error('Selecciona una relación de esta base de datos.');
 const target=repo.detail(relation.config.relationTargetDatabaseId).columns.find(c=>c.id===config.rollupTargetColumnId||(config.rollupTargetColumnId==='__title__'&&c.type==='title'));
 if(!target)throw Error('Selecciona una propiedad de la base relacionada.');
 if(!ROLLUP_FUNCTIONS.some(f=>f.id===config.rollupFunction))throw Error('Agregación no válida.');
 const fn=config.rollupFunction!;
 if(['sum','average','median','min','max','range'].includes(fn)&&!['number','formula','rollup'].includes(target.type))throw Error('Esta agregación requiere una propiedad numérica.');
 if(['checked','unchecked','percent_checked','percent_unchecked'].includes(fn)&&target.type!=='checkbox')throw Error('Esta agregación requiere una casilla.');
 if(['earliest_date','latest_date','date_range'].includes(fn)&&!['date','created_time','last_edited_time'].includes(target.type))throw Error('Esta agregación requiere una fecha.');
}
export function recomputeRollups(repo:Repository,changedDatabase:string) {
 const details=repo.list().map(d=>repo.detail(d.id)),columns=details.flatMap(d=>d.columns),byId=new Map(columns.map(c=>[c.id,c]));
 const targetOf=(c:DatabaseColumn)=>{const relation=byId.get(c.config.rollupRelationColumnId??'');return columns.find(t=>t.databaseId===relation?.config.relationTargetDatabaseId&&(t.id===c.config.rollupTargetColumnId||(c.config.rollupTargetColumnId==='__title__'&&t.type==='title')));};
 const affected=new Set([changedDatabase]);let expanding=true;
 while(expanding){expanding=false;for(const c of columns.filter(c=>c.type==='rollup')){const relation=byId.get(c.config.rollupRelationColumnId??'');if(affected.has(relation?.config.relationTargetDatabaseId??'')&&!affected.has(c.databaseId)){affected.add(c.databaseId);expanding=true;}}}
 const computed=columns.filter(c=>['formula','rollup'].includes(c.type)),visiting=new Set<string>(),done=new Set<string>(),ordered:DatabaseColumn[]=[];
 const visit=(c:DatabaseColumn)=>{if(done.has(c.id))return;if(visiting.has(c.id))throw Error('Referencia circular entre fórmulas y rollups.');visiting.add(c.id);
  const dependencies=c.type==='formula'?formulaDependencies(c.config.formula):[targetOf(c)?.id??''];
  for(const id of dependencies){const dep=byId.get(id);if(dep&&['formula','rollup'].includes(dep.type))visit(dep);}
  visiting.delete(c.id);done.add(c.id);ordered.push(c);
 };
 computed.forEach(visit);
 const cache=new Map<string,RecordRow[]>(),dirty=new Map<string,RecordRow>();
 const rows=(databaseId:string)=>{if(!cache.has(databaseId)){const ids=(repo.db.prepare('SELECT id FROM db_rows WHERE database_id=? ORDER BY position').all(databaseId) as {id:string}[]).map(r=>r.id),result:RecordRow[]=[];for(let i=0;i<ids.length;i+=200)result.push(...repo.hydrate(ids.slice(i,i+200)));cache.set(databaseId,result);}return cache.get(databaseId)!;};
 for(const c of ordered.filter(c=>affected.has(c.databaseId))){const own=rows(c.databaseId);
  if(c.type==='formula')computeFormulas(own,columns.filter(x=>x.databaseId===c.databaseId));
  else {const relation=byId.get(c.config.rollupRelationColumnId??''),target=targetOf(c),targetRows=target?new Map(rows(target.databaseId).map(r=>[r.id,r])):new Map<string,RecordRow>();
   const links=repo.db.prepare("SELECT row_id,target_id FROM db_relations WHERE column_id=? AND target_kind='db_row' ORDER BY position,id").all(relation?.id??'') as {row_id:string;target_id:string}[];
   const grouped=new Map<string,string[]>();for(const link of links){if(!grouped.has(link.row_id))grouped.set(link.row_id,[]);grouped.get(link.row_id)!.push(link.target_id);}
   for(const row of own){const values=target?[...new Set(grouped.get(row.id)??[])].flatMap(id=>{const targetRow=targetRows.get(id);if(!targetRow)return [];return [target.type==='checkbox'?(targetRow.cells[target.id]??'0'):['date','created_time','last_edited_time'].includes(target.type)?targetRow.cells[target.id]??null:exportCellText(target,targetRow)||null];}):[];row.cells[c.id]=target&&c.config.rollupFunction?aggregateRollup(c.config.rollupFunction,values):null;}
  }
  for(const row of own){repo.rawCell(row.id,c.id,row.cells[c.id]??null,c.type);dirty.set(row.id,row);}
 }
 for(const row of dirty.values())repo.indexRow(row.id,columns.filter(c=>c.databaseId===row.databaseId),row);
}
