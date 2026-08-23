// Evvo Food — Service Worker mínimo
//
// Esse arquivo NÃO guarda nada em cache, NÃO funciona offline —
// ele existe só porque o Chrome exige um Service Worker ativo pra
// considerar um site um "PWA completo" e gerar uma instalação como
// app de verdade no Android (em vez de um atalho simples de navegador).
//
// Sem isso, o Chrome trata a instalação de um jeito "reduzido", o que
// pode estar contribuindo pro aviso de "app desatualizado" do Google
// Play Protect em alguns aparelhos.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Deixa toda requisição passar direto pra rede, sem interceptar nada —
// o sistema depende de dados sempre atualizados do Supabase, então
// cache de verdade aqui causaria mais problema do que ajuda
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
