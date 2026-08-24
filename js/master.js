// ============================================================
// Evvo Food — Painel Master: Funcionários + Configurações
// ============================================================

const estado = {
  perfil: null,
  estabelecimento: null,
  funcionarios: [],
};

function alternarMostrarSenha(idCampo, botao) {
  const campo = document.getElementById(idCampo);
  const mostrando = campo.type === 'text';
  campo.type = mostrando ? 'password' : 'text';
  botao.textContent = mostrando ? '👁' : '🙈';
}

// ------------------------------------------------------------
// Exemplos preenchidos do guia de cardápio (só ilustrativo,
// não salva nada — ajuda o Master a visualizar cada tipo de item)
// ------------------------------------------------------------
const EXEMPLOS_TIPO_ITEM = {
  fixo: {
    titulo: 'Exemplo: item "Fixo" — Frango Especial',
    nome: 'Frango Especial',
    descricao: 'Frango, catupiry, queijo, presunto, bacon, palmito, milho e orégano',
    preco: '18,00',
    categoria: 'Pastelão',
    tipo: 'Fixo',
    padrao: ['Frango', 'Catupiry', 'Queijo', 'Presunto', 'Bacon', 'Palmito', 'Milho', 'Orégano'],
    opcao: [{ nome: 'Cheddar', preco: '4,00' }, { nome: 'Calabresa', preco: '4,00' }, { nome: 'Ovo', preco: '4,00' }],
    labelOpcao: 'Acréscimos disponíveis — R$4,00 cada (ou grátis se for substituição de algo removido, veja o guia acima)',
  },
  monte_sabores: {
    titulo: 'Exemplo: "Monte-sabores" — Monte seu Pastel (nome unificado, com degrau de preço)',
    nome: 'Monte seu Pastel',
    descricao: 'Escolha 2 sabores (R$16) — o 3º sobe pra R$17, do 4º em diante é acréscimo normal',
    preco: '16,00',
    categoria: 'Monte seu Pastel',
    tipo: 'Monte-sabores',
    qtdSabores: '2',
    opcao: [{ nome: 'Carne', preco: '3,00' }, { nome: 'Frango', preco: '3,00' }, { nome: 'Queijo', preco: '3,00' }, { nome: 'Bacon', preco: '3,00' }, { nome: '(+9 outros sabores)', preco: '3,00' }],
    labelOpcao: 'Sabores disponíveis (2 inclusos por R$16 — o 3º sabor sobe o total pra R$17 — do 4º em diante, cobra o preço abaixo por sabor)',
  },
  escolha_um: {
    titulo: 'Exemplo: "Escolha 1 sabor" — Pastel Doce',
    nome: 'Pastel Doce',
    descricao: 'Escolha 1 sabor',
    preco: '10,00',
    categoria: 'Doces',
    tipo: 'Escolha 1 sabor',
    opcao: [{ nome: 'Chocolate', preco: null }, { nome: 'Brigadeiro', preco: null }, { nome: 'Beijinho', preco: null }, { nome: '(+5 outros sabores)', preco: null }],
    labelOpcao: 'Sabores disponíveis pra escolher (sem custo extra)',
  },
  venda_direta: {
    titulo: 'Exemplo: "Venda direta" — Refrigerante Lata 350ml',
    nome: 'Refrigerante Lata 350ml',
    descricao: '',
    preco: '6,00',
    categoria: 'Bebidas',
    tipo: 'Venda direta',
  },
};

function abrirExemploTipo(tipo) {
  const ex = EXEMPLOS_TIPO_ITEM[tipo];
  if (!ex) return;

  document.getElementById('exemplo-item-titulo').textContent = ex.titulo;
  document.getElementById('exemplo-nome').value = ex.nome;
  document.getElementById('exemplo-descricao').value = ex.descricao || '(sem descrição)';
  document.getElementById('exemplo-preco').value = ex.preco;
  document.getElementById('exemplo-categoria').value = ex.categoria;
  document.getElementById('exemplo-tipo').value = ex.tipo;

  const campoQtd = document.getElementById('exemplo-campo-qtd');
  if (ex.qtdSabores) {
    campoQtd.style.display = 'block';
    document.getElementById('exemplo-qtd-sabores').value = ex.qtdSabores;
  } else {
    campoQtd.style.display = 'none';
  }

  const secaoIngredientes = document.getElementById('exemplo-secao-ingredientes');
  const labelPadrao = document.getElementById('exemplo-label-padrao');
  const listaPadrao = document.getElementById('exemplo-lista-padrao');
  const labelOpcao = document.getElementById('exemplo-label-opcao');
  const listaOpcao = document.getElementById('exemplo-lista-opcao');

  if (!ex.padrao && !ex.opcao) {
    // Venda direta — não usa ingredientes nenhum
    secaoIngredientes.style.display = 'none';
  } else {
    secaoIngredientes.style.display = 'block';

    if (ex.padrao) {
      labelPadrao.style.display = 'block';
      listaPadrao.style.display = 'flex';
      listaPadrao.innerHTML = ex.padrao.map(nome => `
        <span class="exemplo-chip marcado"><span class="check-visual">✅</span> ${nome}</span>
      `).join('');
    } else {
      labelPadrao.style.display = 'none';
      listaPadrao.style.display = 'none';
    }

    if (ex.opcao) {
      labelOpcao.textContent = ex.labelOpcao;
      labelOpcao.style.display = 'block';
      listaOpcao.style.display = 'flex';
      listaOpcao.innerHTML = ex.opcao.map(o => `
        <span class="exemplo-chip marcado">
          <span class="check-visual">✅</span> ${o.nome}
          ${o.preco ? `<span class="preco-visual">+R$${o.preco}</span>` : ''}
        </span>
      `).join('');
    } else {
      labelOpcao.style.display = 'none';
      listaOpcao.style.display = 'none';
    }
  }

  document.getElementById('modal-exemplo-item-overlay').style.display = 'flex';
}

function fecharExemploTipo() {
  document.getElementById('modal-exemplo-item-overlay').style.display = 'none';
}

// ------------------------------------------------------------
// Modal de confirmação genérico — substitui o confirm() nativo,
// que não é confiável em apps salvos na tela inicial do iPhone
// ------------------------------------------------------------
let acaoConfirmacaoPendente = null;

function mostrarConfirmacaoGenerica(mensagem, aoConfirmar) {
  document.getElementById('confirmacao-generica-texto').textContent = mensagem;
  acaoConfirmacaoPendente = aoConfirmar;
  document.getElementById('modal-confirmacao-generica-overlay').style.display = 'flex';
}

function fecharModalConfirmacaoGenerica() {
  document.getElementById('modal-confirmacao-generica-overlay').style.display = 'none';
  acaoConfirmacaoPendente = null;
}

async function executarConfirmacaoGenerica() {
  const acao = acaoConfirmacaoPendente;
  fecharModalConfirmacaoGenerica();
  if (acao) await acao();
}

async function iniciar() {
  estado.perfil = await verificarAutenticacao();
  if (!estado.perfil) return;

  if (estado.perfil.nivel_acesso !== 'master') {
    document.body.className = ''; // remove o layout de sidebar, senão a mensagem fica espremida
    document.body.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:center; height:100vh; text-align:center; padding:24px;">
        <div>
          <h2 style="font-family:'Bricolage Grotesque',sans-serif; margin-bottom:8px;">Acesso restrito</h2>
          <p style="color:#8A7C68; margin-bottom:16px;">Essa área é exclusiva do Master.</p>
          <a href="atendente.html" style="color:#E8A23A;">Voltar pro atendente</a>
        </div>
      </div>
    `;
    return;
  }

  injetarNavegacao(estado.perfil, 'master');

  await carregarEstabelecimento();
  await carregarFuncionarios();
}

// ------------------------------------------------------------
// Aba ativa
// ------------------------------------------------------------
function mostrarAba(aba) {
  document.querySelectorAll('.aba-conteudo').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.aba-botao').forEach(el => el.classList.remove('on'));
  document.getElementById(`aba-${aba}`).style.display = 'block';
  document.getElementById(`botao-aba-${aba}`).classList.add('on');

  // Segurança extra: limpa os campos de senha ao abrir "Minha Conta" —
  // mesmo que o navegador tente autopreencher com senha salva de outra
  // conta, o campo sempre começa vazio de verdade
  if (aba === 'minhaconta') {
    document.getElementById('input-minha-conta-senha').value = '';
    document.getElementById('input-minha-conta-senha-confirmar').value = '';
  }
}

// ------------------------------------------------------------
// Funcionários
// ------------------------------------------------------------
async function carregarFuncionarios() {
  const { data, error } = await supabaseClient
    .from('perfis')
    .select('id, username, nome, nivel_acesso, ativo, criado_em')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .order('criado_em', { ascending: true });

  if (error) { console.error(error); return; }

  estado.funcionarios = data || [];
  renderFuncionarios();
}

function renderFuncionarios() {
  const container = document.getElementById('lista-funcionarios');

  container.innerHTML = estado.funcionarios.map(f => `
    <div class="funcionario-linha">
      <div>
        <div class="funcionario-nome">${escapeHtml(f.nome)} ${f.nivel_acesso === 'master' ? '<span class="badge-master">MASTER</span>' : ''}</div>
        <div class="funcionario-detalhe">usuário: ${escapeHtml(f.username)}</div>
      </div>
      <div class="funcionario-direita">
        <span class="funcionario-status ${f.ativo ? 'ativo' : 'inativo'}">${f.ativo ? 'Ativo' : 'Inativo'}</span>
        ${f.nivel_acesso !== 'master' ? `
          <button class="btn-toggle-status" onclick="alternarStatusFuncionario('${f.id}', ${!f.ativo})">
            ${f.ativo ? 'Desativar' : 'Ativar'}
          </button>
          <button class="btn-editar-func" onclick="abrirModalEditarFuncionario('${f.id}')">Editar</button>
          <button class="btn-excluir-func" onclick="confirmarExcluirFuncionario('${f.id}', '${f.nome.replace(/'/g, "\\'")}')">Excluir</button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

async function alternarStatusFuncionario(perfilId, novoStatus) {
  const { error } = await supabaseClient
    .from('perfis')
    .update({ ativo: novoStatus })
    .eq('id', perfilId);

  if (error) { mostrarToast('Erro ao atualizar funcionário.', 'erro'); return; }

  mostrarToast(novoStatus ? 'Funcionário reativado.' : 'Funcionário desativado.');
  await carregarFuncionarios();
}

// ------------------------------------------------------------
// Editar funcionário (nome, usuário, senha)
// ------------------------------------------------------------
function abrirModalEditarFuncionario(perfilId) {
  const f = estado.funcionarios.find(x => x.id === perfilId);
  if (!f) return;

  document.getElementById('input-editar-func-id').value = f.id;
  document.getElementById('input-editar-func-nome').value = f.nome;
  document.getElementById('input-editar-func-username').value = f.username;
  document.getElementById('input-editar-func-senha').value = '';
  document.getElementById('input-editar-func-senha-confirmar').value = '';
  document.getElementById('modal-editar-funcionario-overlay').style.display = 'flex';
}

function fecharModalEditarFuncionario() {
  document.getElementById('modal-editar-funcionario-overlay').style.display = 'none';
}

async function salvarEdicaoFuncionario() {
  const perfilId = document.getElementById('input-editar-func-id').value;
  const novoNome = formatarTitulo(document.getElementById('input-editar-func-nome').value.trim());
  const novoUsername = document.getElementById('input-editar-func-username').value.trim().toLowerCase();
  const novaSenha = document.getElementById('input-editar-func-senha').value;
  const novaSenhaConfirmar = document.getElementById('input-editar-func-senha-confirmar').value;

  if (!novoNome || !novoUsername) {
    mostrarToast('Preenche nome e usuário.', 'erro');
    return;
  }
  if (novaSenha && novaSenha.length < 6) {
    mostrarToast('Senha precisa ter pelo menos 6 caracteres.', 'erro');
    return;
  }
  if (novaSenha && novaSenha !== novaSenhaConfirmar) {
    mostrarToast('As senhas não são iguais. Confere de novo.', 'erro');
    return;
  }

  try {
    const { data: sessao } = await supabaseClient.auth.getSession();

    const corpo = { acao: 'editar', funcionario_perfil_id: perfilId, novo_nome: novoNome, novo_username: novoUsername };
    if (novaSenha) corpo.nova_senha = novaSenha;

    const resposta = await fetch(`${SUPABASE_URL}/functions/v1/gerenciar-funcionario`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessao.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpo),
    });

    const resultado = await resposta.json();

    if (!resposta.ok) {
      mostrarToast(resultado.erro || 'Erro ao salvar.', 'erro');
      return;
    }

    mostrarToast('Funcionário atualizado!');
    fecharModalEditarFuncionario();
    await carregarFuncionarios();

  } catch (erro) {
    console.error(erro);
    mostrarToast('Erro de conexão.', 'erro');
  }
}

// ------------------------------------------------------------
// Excluir funcionário (de vez, libera o username pra reuso)
// ------------------------------------------------------------
function confirmarExcluirFuncionario(perfilId, nome) {
  mostrarConfirmacaoGenerica(
    `Excluir "${nome}" de vez? O login dele deixa de existir — diferente de "desativar", isso libera o nome de usuário pra criar outra pessoa com o mesmo username.`,
    async () => {
      try {
        const { data: sessao } = await supabaseClient.auth.getSession();

        const resposta = await fetch(`${SUPABASE_URL}/functions/v1/gerenciar-funcionario`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${sessao.session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ acao: 'excluir', funcionario_perfil_id: perfilId }),
        });

        const resultado = await resposta.json();

        if (!resposta.ok) {
          mostrarToast(resultado.erro || 'Erro ao excluir.', 'erro');
          return;
        }

        mostrarToast('Funcionário excluído.');
        await carregarFuncionarios();

      } catch (erro) {
        console.error(erro);
        mostrarToast('Erro de conexão.', 'erro');
      }
    }
  );
}

function abrirModalFuncionario() {
  document.getElementById('input-func-nome').value = '';
  document.getElementById('input-func-username').value = '';
  document.getElementById('input-func-senha').value = '';
  document.getElementById('modal-funcionario-overlay').style.display = 'flex';
}

function fecharModalFuncionario() {
  document.getElementById('modal-funcionario-overlay').style.display = 'none';
}

async function salvarNovoFuncionario() {
  const nome = formatarTitulo(document.getElementById('input-func-nome').value.trim());
  const username = document.getElementById('input-func-username').value.trim().toLowerCase();
  const senha = document.getElementById('input-func-senha').value;
  const senhaConfirmar = document.getElementById('input-func-senha-confirmar').value;

  if (!nome || !username || !senha) {
    mostrarToast('Preenche nome, usuário e senha.', 'erro');
    return;
  }
  if (senha.length < 6) {
    mostrarToast('Senha precisa ter pelo menos 6 caracteres.', 'erro');
    return;
  }
  if (senha !== senhaConfirmar) {
    mostrarToast('As senhas não são iguais. Confere de novo.', 'erro');
    return;
  }

  const btn = document.getElementById('btn-salvar-funcionario');
  btn.disabled = true;
  btn.textContent = 'Criando...';

  try {
    const { data: sessao } = await supabaseClient.auth.getSession();

    const resposta = await fetch(`${SUPABASE_URL}/functions/v1/criar-funcionario`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessao.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nome, username, senha }),
    });

    const resultado = await resposta.json();

    if (!resposta.ok) {
      mostrarToast(resultado.erro || 'Erro ao criar funcionário.', 'erro');
      return;
    }

    mostrarToast(`Funcionário "${nome}" criado com sucesso!`);
    fecharModalFuncionario();
    await carregarFuncionarios();

  } catch (erro) {
    console.error(erro);
    mostrarToast('Erro de conexão ao criar funcionário.', 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar funcionário';
  }
}

// ------------------------------------------------------------
// Configurações do estabelecimento
// ------------------------------------------------------------
async function carregarEstabelecimento() {
  const { data, error } = await supabaseClient
    .from('estabelecimentos')
    .select('id, nome, modo_atendimento, permite_entrega, taxa_servico_padrao')
    .eq('id', estado.perfil.estabelecimento_id)
    .single();

  if (error) { console.error(error); return; }

  estado.estabelecimento = data;
  document.getElementById('config-nome-estabelecimento').textContent = data.nome;
  document.getElementById('input-modo-atendimento').value = data.modo_atendimento;
  document.getElementById('input-permite-entrega').checked = data.permite_entrega;
  document.getElementById('input-taxa-padrao').value = String(data.taxa_servico_padrao).replace('.', ',');
}

async function salvarConfiguracoes() {
  const modoAtendimento = document.getElementById('input-modo-atendimento').value;
  const permiteEntrega = document.getElementById('input-permite-entrega').checked;
  const taxaTexto = document.getElementById('input-taxa-padrao').value;
  const taxaPadrao = parseFloat(taxaTexto.replace(',', '.')) || 0;

  const { error } = await supabaseClient
    .from('estabelecimentos')
    .update({
      modo_atendimento: modoAtendimento,
      permite_entrega: permiteEntrega,
      taxa_servico_padrao: taxaPadrao,
    })
    .eq('id', estado.perfil.estabelecimento_id);

  if (error) {
    mostrarToast('Erro ao salvar configurações.', 'erro');
    return;
  }

  mostrarToast('Configurações salvas!');
  await carregarEstabelecimento();
}

// ------------------------------------------------------------
// Minha Conta — trocar meu próprio username/senha
// ------------------------------------------------------------
async function salvarMinhaConta() {
  const novoUsername = document.getElementById('input-minha-conta-username').value.trim().toLowerCase();
  const novaSenha = document.getElementById('input-minha-conta-senha').value;
  const novaSenhaConfirmar = document.getElementById('input-minha-conta-senha-confirmar').value;

  if (!novoUsername) {
    mostrarToast('Digite o novo usuário.', 'erro');
    return;
  }
  if (novaSenha && novaSenha.length < 6) {
    mostrarToast('Senha precisa ter pelo menos 6 caracteres.', 'erro');
    return;
  }
  if (novaSenha && novaSenha !== novaSenhaConfirmar) {
    mostrarToast('As senhas não são iguais. Confere de novo.', 'erro');
    return;
  }

  const confirmar = confirm(`Trocar seu login pra "${novoUsername}"${novaSenha ? ' com senha nova' : ''}? Você vai continuar logado agora, mas da próxima vez use o usuário novo.`);
  if (!confirmar) return;

  try {
    const { data: sessao } = await supabaseClient.auth.getSession();

    const corpo = { novo_username: novoUsername };
    if (novaSenha) corpo.nova_senha = novaSenha; // só manda senha se realmente for trocar

    const resposta = await fetch(`${SUPABASE_URL}/functions/v1/atualizar-credenciais`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessao.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpo),
    });

    const resultado = await resposta.json();

    if (!resposta.ok) {
      mostrarToast(resultado.erro || 'Erro ao salvar.', 'erro');
      return;
    }

    mostrarToast(`Login atualizado pra "${novoUsername}"! Use esse usuário no próximo login.`);
    sessionStorage.removeItem('comandaflow_perfil');
    document.getElementById('input-minha-conta-senha').value = '';

  } catch (erro) {
    console.error(erro);
    mostrarToast('Erro de conexão.', 'erro');
  }
}

iniciar();
