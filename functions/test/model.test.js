import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaymentIndex, buildComputedIndex, buildIntegratedLead, buildCrmLead, markAttributionOwners } from '../model.js';
import attribution from '../attribution.cjs';
const student = 'abcdefghijklmnop';
test('CRM enrollment without RIP link is still an enrollment', () => {
  const lead = buildCrmLead({ id: '1', campaignId: 'ads', desenlace: 'matriculado', fecha: '2026-11-02' }, new Map(), new Map());
  assert.equal(lead.status, 'Matrícula');
  assert.equal(lead.crmStage, 'enrolled');
});
test('historical and CRM contacts share revenue attribution only once', () => {
  const payments = buildPaymentIndex([{ studentId: student, valorPago: 100000 }]);
  const computed = buildComputedIndex([{ id: student, clasificacionFinal: 'Activo' }]);
  const historic = buildIntegratedLead({ id: 'old', sheetId: 'sheet', marketingAttribution: { originType: 'paid_ads', campaignId: 'ads', capturedAt: new Date('2026-10-01T14:00:00Z') }, enrollment: { studentId: student } }, payments, computed);
  const crm = buildCrmLead({ id: 'new', campaignId: 'ads', fecha: '2026-11-02', studentIds: [student] }, payments, computed);
  markAttributionOwners([historic, crm]);
  assert.equal(historic.paidValue, 100000);
  assert.equal(crm.paidValue, 0);
  assert.equal(crm.countsForAttribution, false);
});
test('manual CRM campaign takes precedence over ad referral', () => {
  const result = attribution.campanaDe({ atribucionManual: { campaignId: 'correct' }, adOrigen: { adId: '123456' } }, [{ id: 'correct' }, { id: 'other', metaAdIds: ['123456'] }]);
  assert.equal(result.campaignId, 'correct');
});
test('legacy timestamp dates use Bogota on the server', () => {
  const result = buildIntegratedLead({ id: 'row', sheetId: 'sheet', marketingAttribution: { originType: 'paid_ads', capturedAt: { toDate: () => new Date('2026-10-10T02:00:00Z') } } }, new Map(), new Map());
  assert.equal(result.date, '2026-10-09');
});
