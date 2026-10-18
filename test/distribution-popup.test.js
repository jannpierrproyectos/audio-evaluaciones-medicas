import test from 'node:test';
import assert from 'node:assert/strict';
import { createWhatsAppCheckWindow } from '../src/lib/whatsappReview.js';

test('Distribución: si Windows rechaza cerrar el chat, no abre otro ni afirma comprobación', async () => {
  let opens = 0, navigations = 0;
  const previous = { closed: false, close() {}, location: { replace() { if (++navigations > 1) throw new Error('SecurityError'); } } };
  const next = { closed: false, location: { replace() {} } };
  const open = createWhatsAppCheckWindow(() => ++opens === 1 ? previous : next);
  await open({ datos_operativos: { telefono: '999111111' } });
  await assert.rejects(open({ datos_operativos: { telefono: '999222222' } }), /cierra la conversación anterior/);
  assert.equal(opens, 1);
  previous.closed = true;
  await open({ datos_operativos: { telefono: '999222222' } });
  assert.equal(opens, 2);
});

test('Distribución: espera cierre asíncrono y rechaza aperturas simultáneas', async () => {
  let opens = 0, navigations = 0;
  const previous = { closed: false, close() { setTimeout(() => { this.closed = true; }, 30); }, location: { replace() { if (++navigations > 1) throw new Error('SecurityError'); } } };
  const next = { closed: false, location: { replace() {} } };
  const open = createWhatsAppCheckWindow(() => ++opens === 1 ? previous : next);
  await open({ datos_operativos: { telefono: '999111111' } });
  const pending = open({ datos_operativos: { telefono: '999222222' } });
  await assert.rejects(open({ datos_operativos: { telefono: '999333333' } }), /Espera/);
  assert.equal(opens, 1);
  await pending; assert.equal(opens, 2); assert.equal(previous.closed, true);
});
