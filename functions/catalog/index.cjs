const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { http } = require('@google-cloud/functions-framework');
const db = getFirestore(initializeApp());
http('syncAdsCatalog', async (req, res) => {
  // Invocation is restricted by Cloud Run IAM to the Ads synchronization account.
  if (req.method !== 'POST' || !Array.isArray(req.body?.campaigns)) return res.sendStatus(400);
  const campaigns = req.body.campaigns;
  if (campaigns.length > 5000 || campaigns.some((c) => !c.id || /\//.test(c.id) || typeof c.nombre !== 'string')) return res.sendStatus(400);
  const current = await db.collection('campanasAds').get();
  const existing = new Map(current.docs.map((d) => [d.id, d.data()]));
  const changed = campaigns.filter((c) => Object.keys(c).some((key) => JSON.stringify(c[key]) !== JSON.stringify(existing.get(c.id)?.[key])));
  for (let start = 0; start < changed.length; start += 400) {
    const batch = db.batch();
    for (const c of changed.slice(start, start + 400)) {
      batch.set(db.collection('campanasAds').doc(c.id), {
        id: c.id, nombre: c.nombre, plataforma: String(c.plataforma || ''), activa: c.activa === true,
        metaAdIds: Array.isArray(c.metaAdIds) ? c.metaAdIds.map(String) : [], codigo: String(c.codigo || ''),
        desde: String(c.desde || ''), hasta: String(c.hasta || ''),
        actualizadoAt: FieldValue.serverTimestamp(), actualizadoPor: 'ads-server',
      }, { merge: true });
    }
    await batch.commit();
  }
  res.json({ ok: true, updated: changed.length });
});
