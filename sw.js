// GMS Livraison — Service Worker v1
const CACHE_NAME = 'gms-v1';
const FIREBASE_PROJECT = 'livraison-niamey';
const API_KEY = 'AIzaSyBAO9nzfuLvsPryUcGNtKjBBW_Wcf5DuCs';

// IDs des commandes déjà notifiées — persistées dans Cache API
let commandesNotifiees = new Set();

async function chargerCommandesNotifiees() {
  try {
    const cache = await caches.open('gms-notif-state');
    const res = await cache.match('notifiees');
    if (res) {
      const ids = await res.json();
      ids.forEach(id => commandesNotifiees.add(id));
    }
  } catch(e) {}
}

async function sauvegarderCommandesNotifiees() {
  try {
    const cache = await caches.open('gms-notif-state');
    await cache.put('notifiees', new Response(JSON.stringify([...commandesNotifiees])));
  } catch(e) {}
}

// ─── INSTALLATION ───
self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    clients.claim().then(() => chargerCommandesNotifiees())
  );
});

async function verifierNouvellesCommandes() {
  try {
    // Requête REST Firestore — commandes en attente
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/commandes?key=${API_KEY}&pageSize=20`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.documents) return;

    const commandes = data.documents.map(d => {
      const f = d.fields || {};
      return {
        id: d.name.split('/').pop(),
        client: f.client?.stringValue || '—',
        depart: f.depart?.stringValue || '—',
        arrivee: f.arrivee?.stringValue || '—',
        statut: f.statut?.stringValue || '—',
        colisTotal: parseInt(f.colisTotal?.integerValue || '1'),
        numeroSuivi: f.numeroSuivi?.stringValue || ''
      };
    });

    // Filtrer celles en attente et non encore notifiées
    const enAttente = commandes.filter(c =>
      c.statut === 'En attente' && !commandesNotifiees.has(c.id)
    );

    for (const cmd of enAttente) {
      commandesNotifiees.add(cmd.id);
      await sauvegarderCommandesNotifiees();
      const nbColis = cmd.colisTotal > 1 ? ` (${cmd.colisTotal} colis)` : '';
      await self.registration.showNotification('🛵 Nouvelle commande GMS !', {
        body: `${cmd.client}${nbColis}\n${cmd.depart} → ${cmd.arrivee}`,
        icon: 'https://i.postimg.cc/DWMcym3K/IMG-20260303-WA0000.jpg',
        badge: 'https://i.postimg.cc/DWMcym3K/IMG-20260303-WA0000.jpg',
        tag: 'gms-commande-' + cmd.id,
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 200],
        data: { url: self.registration.scope }
      });
    }
  } catch(e) {
    // Silencieux en cas d'erreur réseau
  }
}

// ─── CLIC SUR NOTIFICATION ───
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Si l'app est déjà ouverte, la ramener au premier plan
      for (const client of list) {
        if (client.url.includes(self.registration.scope)) {
          return client.focus();
        }
      }
      // Sinon ouvrir l'app
      return clients.openWindow(self.registration.scope);
    })
  );
});

// ─── SYNC EN ARRIÈRE-PLAN (Android) ───
self.addEventListener('periodicsync', e => {
  if (e.tag === 'gms-check-commandes') {
    e.waitUntil(verifierNouvellesCommandes());
  }
});
