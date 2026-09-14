import { createHash } from 'node:crypto';
import { linkSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { secretKey, extractPage, redactBrowserText, sanitizeBrowserPage } from './browser-page.mjs';
// Same-directory staging + exclusive link: no partial destination and no overwrite.
export function saveCollectionFile(path, content) {
  const temporary = mkdtempSync(join(dirname(path), '.mediastorm-export-'));
  try {
    const file = join(temporary,'data');
    writeFileSync(file, content, {mode:0o600});
    linkSync(file, path);
  } finally { rmSync(temporary, {recursive:true,force:true}); }
}
export function collectionEngineSource() {
  return `const secretKey = ${secretKey.toString()};\n` + [redactBrowserText,extractPage,sanitizeBrowserPage,requireCollectionDataPlan,collectionRows,collectionCSV].map(fn=>'export '+fn.toString()).join('\n\n');
}
const engineDigest = () => createHash('sha256').update(collectionEngineSource()).digest('hex');
export const collectionDataKind = 'mediastorm-collection-data';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function requireCollectionDataPlan(plan) {
  if (plan?.status !== 'confirmed' || plan.plan.capture !== 'current-page-table' || !['data','chrome-extension'].includes(plan.plan.delivery.format) || !plan.plan.source.url) throw new Error('请先确认数据或Chrome插件交付、当前页表格模式及来源地址。');
  if (!plan.plan.samples.length || plan.plan.samples.some(row=>row.some(value=>value === null))) throw new Error('执行前需要至少一条完整、已确认的预期样例；请先补齐方案。');
}
export function collectionRows(plan, snapshot) {
  requireCollectionDataPlan(plan);
  if (!snapshot || snapshot.pageUrl !== plan.plan.source.url || snapshot.tablesTruncated || !Array.isArray(snapshot.tables)) throw new Error('实际页面地址不匹配或表格快照不完整，未生成交付。');
  const columns = plan.plan.fields.map(field=>field.name);
  const candidates = snapshot.tables.filter(table=>Array.isArray(table.headers) && columns.every(name=>table.headers.includes(name)));
  if (candidates.length !== 1) throw new Error('字段不匹配或有多个候选表格，请重新调查并确认；不自动猜选。');
  const table = candidates[0];
  if (table.issue || new Set(table.headers).size !== table.headers.length || table.headers.some(name=>!name) || !Array.isArray(table.rows) || table.rows.length > 50 || table.rows.length > plan.plan.maxRecords) throw new Error('表格结构、表头或条数超限，未生成部分交付。');
  if (table.rows.some(row=>!Array.isArray(row) || row.length !== table.headers.length || row.some(value=>typeof value !== 'string' || value.length > 300 || value.includes('[REDACTED]')))) throw new Error('表格行不完整或内容已过滤，不能交付。');
  const records = table.rows.map(row=>columns.map(name=>row[table.headers.indexOf(name)]));
  if (new Set(records.map(row=>JSON.stringify(row))).size !== records.length) throw new Error('所选字段出现完全重复记录，需核对唯一字段后重试。');
  // ponytail: repeat runs require the same samples; add a separately confirmed identity rule when data changes.
  const samples = plan.plan.samples;
  if (!samples.every(sample=>records.some(row=>JSON.stringify(row) === JSON.stringify(sample)))) throw new Error('当前表格与已确认样例不一致，未生成交付。');
  return {columns, records};
}
export function buildCollectionData(plan, snapshot) {
  const {columns,records} = collectionRows(plan,snapshot);
  const data = {version:1, untrusted:true, engineDigest:engineDigest(), planDigest:plan.digest, source:snapshot.pageUrl, capturedAt:new Date().toISOString(), columns, records,
    coverage:'single-visible-table-snapshot', sampleMatched:true, allPagesVerified:false, filtersVerified:false,
    warning:'仅本次新建页中的可见表格快照；不证明分页完整性、筛选条件或时间范围正确。CSV会将疑似公式单元格转为文本，JSON保留原值。'};
  return {status:'ready', data, digest:hash(data)};
}
export function currentCollectionData(manager, plan) {
  const item = manager?.getBranch().findLast(entry=>entry.type === 'custom' && entry.customType === collectionDataKind)?.data;
  if (!item || item.status !== 'ready' || plan?.status !== 'confirmed' || item.data?.planDigest !== plan.digest) return null;
  if (item.digest !== hash(item.data)) throw new Error('采集结果摘要不匹配，不能导出。');
  if (item.data.engineDigest !== engineDigest()) return null;
  return item;
}
export function serializeCollectionData(artifact, format) {
  if (!artifact || artifact.status !== 'ready' || artifact.digest !== hash(artifact.data) || artifact.data.engineDigest !== engineDigest()) throw new Error('没有可导出的当前采集结果。');
  if (format === 'json') return JSON.stringify({...artifact.data, digest:artifact.digest}, null, 2) + '\n';
  if (format !== 'csv') throw new Error('仅支持CSV或JSON导出。');
  return collectionCSV(artifact.data.columns,artifact.data.records);
}
export function collectionCSV(columns, records) {
  const cell = value => {
    const safe = /^[\s\x00-\x1f]*[=+\-@]/.test(value) || /^[\x00-\x1f]/.test(value) ? "'" + value : value;
    return '"' + safe.replaceAll('"','""') + '"';
  };
  return '\uFEFF' + [columns,...records].map(row=>row.map(cell).join(',')).join('\r\n') + '\r\n';
}
