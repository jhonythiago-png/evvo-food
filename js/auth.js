// ============================================================
// Evvo Food — Autenticação
// ============================================================

const CHAVE_PERFIL = 'comandaflow_perfil';

/**
 * Confere se existe uma sessão válida do Supabase e, se sim,
 * garante que o perfil (nome, nível de acesso, estabelecimento)
 * esteja disponível em sessionStorage.
 * Se não houver sessão, redireciona pro login.
 */
/**
 * Confere se existe uma sessão válida do Supabase e se o perfil ainda
 * está ATIVO (sempre confere de novo no banco, nunca confia só no cache —
 * assim, se o Master desativar alguém, o acesso é cortado na hora).
 */
async function verificarAutenticacao() {
  const { data: sessao } = await supabaseClient.auth.getSession();
  if (!sessao?.session) {
    const paginaAtual = window.location.pathname.split('/').pop();
    window.location.href = `index.html?redirect=${encodeURIComponent(paginaAtual)}`;
    return null;
  }

  const { data: perfil, error } = await supabaseClient
    .from('perfis')
    .select('id, nome, username, nivel_acesso, estabelecimento_id, ativo, precisa_trocar_senha')
    .eq('auth_user_id', sessao.session.user.id)
    .single();

  if (error || !perfil) {
    window.location.href = 'index.html';
    return null;
  }

  if (!perfil.ativo) {
    await supabaseClient.auth.signOut();
    sessionStorage.removeItem(CHAVE_PERFIL);
    window.location.href = 'index.html?motivo=desativado';
    return null;
  }

  sessionStorage.setItem(CHAVE_PERFIL, JSON.stringify(perfil));

  // Se a senha foi resetada pelo admin (esqueceu/perdeu), bloqueia TUDO
  // até a pessoa definir uma senha nova — funciona em qualquer tela,
  // já que essa função roda no início de toda página do sistema
  if (perfil.precisa_trocar_senha) {
    exibirBloqueioTrocaSenhaObrigatoria();
    return null; // impede a tela de continuar carregando por baixo do bloqueio
  }

  return perfil;
}

/**
 * Mostra uma tela cheia, por cima de tudo, obrigando a pessoa a definir
 * uma senha nova antes de conseguir usar qualquer parte do sistema.
 * Injeta o próprio HTML/CSS via JS — assim funciona em QUALQUER página
 * sem precisar editar o HTML de cada tela uma por uma.
 */
function exibirBloqueioTrocaSenhaObrigatoria() {
  if (document.getElementById('bloqueio-troca-senha-overlay')) return; // já está mostrando

  const overlay = document.createElement('div');
  overlay.id = 'bloqueio-troca-senha-overlay';
  overlay.style.cssText = 'position:fixed; inset:0; background:#17140F; z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; font-family:Inter,sans-serif;';
  overlay.innerHTML = `
    <div style="background:#211D16; border:1px solid #38322A; border-radius:16px; padding:28px; width:100%; max-width:380px;">
      <h2 style="font-family:'Bricolage Grotesque',sans-serif; color:#fff; margin-bottom:8px; font-size:19px;">Defina uma senha nova</h2>
      <p style="color:#8A7C68; font-size:13px; margin-bottom:20px;">Sua senha foi resetada. Antes de continuar, defina uma senha só sua.</p>

      <div style="margin-bottom:12px;">
        <label style="display:block; font-size:12px; color:#8A7C68; margin-bottom:5px;">Nova senha (mínimo 6 caracteres)</label>
        <div style="display:flex; gap:8px;">
          <input type="password" id="bloqueio-nova-senha" style="flex:1; padding:10px; border-radius:8px; border:1px solid #38322A; background:#17140F; color:#fff;">
          <button type="button" onclick="const c=document.getElementById('bloqueio-nova-senha'); const m=c.type==='text'; c.type=m?'password':'text'; this.textContent=m?'👁':'🙈';" style="flex-shrink:0; padding:0 14px; border-radius:8px; border:1px solid #38322A; background:transparent; color:#fff;">👁</button>
        </div>
      </div>
      <div style="margin-bottom:20px;">
        <label style="display:block; font-size:12px; color:#8A7C68; margin-bottom:5px;">Confirmar nova senha</label>
        <div style="display:flex; gap:8px;">
          <input type="password" id="bloqueio-nova-senha-confirmar" style="flex:1; padding:10px; border-radius:8px; border:1px solid #38322A; background:#17140F; color:#fff;">
          <button type="button" onclick="const c=document.getElementById('bloqueio-nova-senha-confirmar'); const m=c.type==='text'; c.type=m?'password':'text'; this.textContent=m?'👁':'🙈';" style="flex-shrink:0; padding:0 14px; border-radius:8px; border:1px solid #38322A; background:transparent; color:#fff;">👁</button>
        </div>
      </div>

      <div id="bloqueio-troca-senha-erro" style="color:#D6432A; font-size:12px; margin-bottom:12px; display:none;"></div>

      <button id="bloqueio-troca-senha-botao" onclick="confirmarTrocaSenhaObrigatoria()" style="width:100%; padding:12px; border-radius:10px; border:none; background:linear-gradient(135deg,#ff7a1a,#ff2d78); color:#fff; font-weight:700; font-size:14px;">Definir senha e continuar</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function confirmarTrocaSenhaObrigatoria() {
  const novaSenha = document.getElementById('bloqueio-nova-senha').value;
  const confirmarSenha = document.getElementById('bloqueio-nova-senha-confirmar').value;
  const erroEl = document.getElementById('bloqueio-troca-senha-erro');
  const botao = document.getElementById('bloqueio-troca-senha-botao');

  erroEl.style.display = 'none';

  if (!novaSenha || novaSenha.length < 6) {
    erroEl.textContent = 'A senha precisa ter pelo menos 6 caracteres.';
    erroEl.style.display = 'block';
    return;
  }
  if (novaSenha !== confirmarSenha) {
    erroEl.textContent = 'As senhas não são iguais. Confere de novo.';
    erroEl.style.display = 'block';
    return;
  }

  botao.disabled = true;
  botao.textContent = 'Salvando...';

  try {
    const perfilAtual = obterPerfilAtual();
    const { data: sessao } = await supabaseClient.auth.getSession();

    const resposta = await fetch(`${SUPABASE_URL}/functions/v1/atualizar-credenciais`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessao.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        novo_username: perfilAtual.username, // mantém o mesmo username, só troca a senha
        nova_senha: novaSenha,
      }),
    });

    const resultado = await resposta.json();

    if (!resposta.ok) {
      erroEl.textContent = resultado.erro || 'Erro ao salvar. Tenta de novo.';
      erroEl.style.display = 'block';
      botao.disabled = false;
      botao.textContent = 'Definir senha e continuar';
      return;
    }

    // Recarrega a página — na próxima verificação, precisa_trocar_senha já
    // vai vir false, e o sistema libera o acesso normalmente
    window.location.reload();

  } catch (erro) {
    console.error(erro);
    erroEl.textContent = 'Erro de conexão. Tenta de novo.';
    erroEl.style.display = 'block';
    botao.disabled = false;
    botao.textContent = 'Definir senha e continuar';
  }
}

function obterPerfilAtual() {
  const perfilSalvo = sessionStorage.getItem(CHAVE_PERFIL);
  return perfilSalvo ? JSON.parse(perfilSalvo) : null;
}

async function fazerLogout() {
  await supabaseClient.auth.signOut();
  sessionStorage.removeItem(CHAVE_PERFIL);
  window.location.href = 'index.html';
}

function mostrarToast(mensagem, tipo = 'ok') {
  const toastAntigo = document.querySelector('.toast');
  if (toastAntigo) toastAntigo.remove();

  const toast = document.createElement('div');
  toast.className = 'toast' + (tipo === 'erro' ? ' erro' : '');
  toast.textContent = mensagem;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

/**
 * Formata como "Nome Próprio": primeira letra de cada palavra maiúscula,
 * resto minúsculo, mas mantém conectores comuns em português em minúsculo
 * (exceto se forem a primeira palavra). Usado pra nome de pessoa, item do
 * cardápio, categoria, ingrediente, etc — evita "joao", "JOAO", "João" misturados.
 */
const CONECTORES_MINUSCULOS = ['de', 'da', 'do', 'das', 'dos', 'e'];

function formatarTitulo(texto) {
  if (!texto) return texto;
  const limpo = texto.trim().replace(/\s+/g, ' ');
  if (!limpo) return limpo;
  return limpo.split(' ').map((palavra, i) => {
    const minuscula = palavra.toLowerCase();
    if (i > 0 && CONECTORES_MINUSCULOS.includes(minuscula)) return minuscula;
    return minuscula.charAt(0).toUpperCase() + minuscula.slice(1);
  }).join(' ');
}

/**
 * Formata só a primeira letra em maiúscula, sem mexer no resto —
 * usado em campos de texto corrido (descrição, motivo), onde title-case
 * em cada palavra ficaria estranho.
 */
function formatarPrimeiraLetra(texto) {
  if (!texto) return texto;
  const limpo = texto.trim().replace(/\s+/g, ' ');
  if (!limpo) return limpo;
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

/**
 * Escapa texto antes de inserir via innerHTML/template literal.
 * SEM isso, um nome de cliente, motivo de despesa, ou item do cardápio
 * contendo algo como <img src=x onerror=...> executaria como HTML de
 * verdade na tela de QUALQUER outro funcionário que visse aquele dado —
 * é o item mais importante da auditoria de segurança feita em 20/08/2026.
 * Usar em TODO texto digitado por pessoa que aparece via innerHTML.
 */
function escapeHtml(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Monta o menu do sistema (logo + navegação + usuário/sair) — aparece
 * em toda tela, mostrando só o que aquele nível de acesso pode ver.
 * No notebook fica como sidebar fixa lateral; no celular vira barra no topo.
 */
function injetarNavegacao(perfil, paginaAtual) {
  const container = document.getElementById('sidebar');
  if (!container || !perfil) return;

  const paginas = [
    { id: 'atendente', label: 'Atendente', href: 'atendente.html', masterOnly: false },
    { id: 'caixa', label: 'Caixa', href: 'caixa.html', masterOnly: false },
    { id: 'financeiro', label: 'Financeiro', href: 'financeiro.html', masterOnly: true },
    { id: 'cardapio', label: 'Cardápio', href: 'cardapio.html', masterOnly: true },
    { id: 'master', label: 'Config', href: 'master.html', masterOnly: true },
    // Só pro Funcionário — o Master já tem esse conteúdo dentro de Config
    { id: 'informacoes', label: 'Informação', href: 'informacoes.html', funcionarioOnly: true },
  ];

  const visiveis = paginas.filter(p => {
    if (p.funcionarioOnly) return perfil.nivel_acesso !== 'master';
    return !p.masterOnly || perfil.nivel_acesso === 'master';
  });

  const linksHtml = visiveis.map(p => `
    <a href="${p.href}" class="sidebar-nav-link ${p.id === paginaAtual ? 'on' : ''}">${p.label}</a>
  `).join('');

  container.innerHTML = `
    <span class="sidebar-logo">Evvo Food</span>
    <span class="sidebar-slogan">A evolução no comando do seu negócio.</span>
    <nav class="sidebar-nav">${linksHtml}</nav>
    <div class="sidebar-footer">
      <span>${perfil.nome}</span>
      <button onclick="fazerLogout()">saír</button>
    </div>
  `;
}

// Registra o Service Worker (uma vez por página) — necessário pro Android
// tratar a instalação como um app completo, não um atalho reduzido
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((erro) => {
    console.log('Service Worker não registrado:', erro);
  });
}
