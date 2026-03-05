/* ═══════════════════════════════════════════════
   GTM Pipeline Hub — Status Polling
   Vanilla JS, no dependencies
   ═══════════════════════════════════════════════ */

const POLL_INTERVAL_MS = 15_000;

const PRODUCTS = [
  { id: 'ad-generator',  name: 'Ad Generator',  port: 3001 },
  { id: 'flowdrip',      name: 'FlowDrip',      port: 3000 },
  { id: 'orchestrator',  name: 'Orchestrator',   port: 4312 },
];

// ── DOM references ──

const summaryEl  = document.getElementById('status-summary');
const beaconEl   = document.getElementById('global-beacon');

// ── Status check ──

async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    updateUI(data.products);
  } catch {
    // Hub API itself unreachable — mark all unknown
    updateUI(PRODUCTS.map(p => ({ ...p, status: 'unknown' })));
  }
}

function updateUI(products) {
  let onlineCount = 0;

  for (const product of products) {
    // Status dot
    const dot = document.getElementById(`status-${product.id}`);
    if (dot) {
      dot.dataset.status = product.status;
      dot.setAttribute('aria-label', `${product.name}: ${product.status}`);
    }

    // Card data attribute
    const card = document.querySelector(`[data-product="${product.id}"]`);
    if (card) {
      card.dataset.status = product.status;
    }

    if (product.status === 'online') onlineCount++;
  }

  // Topbar summary
  if (summaryEl) {
    const total = products.length;
    summaryEl.dataset.online = String(onlineCount);
    summaryEl.dataset.total  = String(total);

    // Update text (keep the beacon span)
    const textNode = summaryEl.lastChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      textNode.textContent = ` ${onlineCount}/${total} services online`;
    } else {
      summaryEl.appendChild(document.createTextNode(` ${onlineCount}/${total} services online`));
    }
  }

  // Global beacon state
  if (beaconEl) {
    const total = products.length;
    if (onlineCount === total) {
      beaconEl.dataset.state = 'all-online';
    } else if (onlineCount > 0) {
      beaconEl.dataset.state = 'partial';
    } else {
      beaconEl.dataset.state = 'all-offline';
    }
  }
}

// ── Init ──

checkStatus();
setInterval(checkStatus, POLL_INTERVAL_MS);
