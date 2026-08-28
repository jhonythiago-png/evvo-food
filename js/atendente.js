// ============================================================
// Evvo Food — App do Atendente
// ============================================================

const estado = {
  perfil: null,
  comandaAtual: null,        // { id, numero_sequencial, tipo, numero_mesa, nome_cliente }
  cardapio: [],               // [{ categoria, itens: [{...item, ingredientes: [...]}] }]
  categoriaAtivaIndex: 0,
  carrinho: [],                // [{ item, quantidade, precoUnitario, observacao, sabores: [{id, nome, foiAcrescimo, precoAcrescimo}] }]
  observacoesGerais: [],        // ["3 copos com limão e gelo", "2 pratos com talheres", ...]
  itemEmEdicao: null,          // item sendo montado no modal agora
  selecaoSabores: [],          // ordem de seleção de sabores no modal (pro cálculo de cota)
  ingredientesRemovidos: [],   // ids removidos de um item 'fixo' no modal
  acrescimosSelecionados: [],  // ids de acréscimo pago escolhidos num item 'fixo'
  observacaoAtual: '',          // texto da observação do item sendo montado agora (reseta a cada item novo)
  ultimosPedidosEnviados: [],  // cache da última consulta de "pedidos enviados" (usado pelo botão cancelar)
};

// ------------------------------------------------------------
// Inicialização
// ------------------------------------------------------------
async function iniciar() {
  estado.perfil = await verificarAutenticacao();
  if (!estado.perfil) return;

  injetarNavegacao(estado.perfil, 'atendente');

  await carregarConfiguracaoEstabelecimento();
  await carregarCardapio();
  await carregarComandasAbertas();
  await verificarStatusCaixa();
  escutarMudancasComandas();

  // Verificação automática a cada 5s — garante que a lista/comanda atual
  // fique sempre atualizada, mesmo se o aviso em tempo real não chegar
  setInterval(() => {
    verificarAtualizacoes();
    verificarStatusCaixa();
  }, 5000);
}

// Mostra um aviso na tela inicial se o caixa do turno ainda não foi
// aberto — evita que o atendente monte um pedido inteiro só pra
// descobrir, na hora de enviar, que o caixa está fechado
async function verificarStatusCaixa() {
  const { count, error } = await supabaseClient
    .from('caixas_turno')
    .select('id', { count: 'exact', head: true })
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .eq('status', 'aberto');

  if (error) { console.error(error); return; }

  const aviso = document.getElementById('aviso-caixa-fechado');
  if (aviso) aviso.style.display = count ? 'none' : 'block';
}

async function carregarConfiguracaoEstabelecimento() {
  const { data, error } = await supabaseClient
    .from('estabelecimentos')
    .select('permite_entrega')
    .eq('id', estado.perfil.estabelecimento_id)
    .single();

  if (!error && data?.permite_entrega) {
    document.getElementById('bloco-nova-comanda-entrega').style.display = 'block';
  }
}

async function verificarAtualizacoes() {
  const telaSelecao = document.getElementById('tela-selecao-comanda');
  const naListaDeComandas = telaSelecao.style.display !== 'none';

  if (naListaDeComandas) {
    carregarComandasAbertas();
    return;
  }

  // Se estiver dentro de uma comanda, confirma se ela ainda está aberta
  if (estado.comandaAtual) {
    const { data, error } = await supabaseClient
      .from('comandas')
      .select('status')
      .eq('id', estado.comandaAtual.id)
      .single();

    if (!error && data?.status && data.status !== 'aberta') {
      mostrarToast(data.status === 'cancelada' ? 'Essa comanda foi cancelada.' : 'Essa comanda foi fechada pelo caixa.');
      voltarParaComandas();
    }
  }
}

/**
 * Fica ouvindo mudanças na tabela "comandas" em tempo real —
 * assim, quando o caixa fecha uma conta, ela some da lista sozinha,
 * sem precisar dar F5 nem deslogar/logar de novo.
 */
function escutarMudancasComandas() {
  supabaseClient
    .channel('comandas_mudancas')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'comandas',
      },
      (payload) => {
        console.log('[Realtime] comandas mudou:', payload);

        // Como tiramos o filtro do servidor, confirma aqui no código
        // que a mudança é do MESMO estabelecimento (importante quando
        // existirem outros clientes usando o Evvo Food no futuro)
        const linhaMudada = payload.new?.estabelecimento_id ? payload.new : payload.old;
        if (linhaMudada?.estabelecimento_id !== estado.perfil.estabelecimento_id) {
          return;
        }

        // Se a comanda que mudou é a que o atendente está usando agora, e ela fechou,
        // avisa e volta pra lista automaticamente
        if (
          estado.comandaAtual &&
          payload.new?.id === estado.comandaAtual.id &&
          payload.new?.status && payload.new.status !== 'aberta'
        ) {
          mostrarToast(payload.new.status === 'cancelada' ? 'Essa comanda foi cancelada.' : 'Essa comanda foi fechada pelo caixa.');
          voltarParaComandas();
          return;
        }

        // Se estiver na tela de lista (escolhendo comanda), atualiza a lista sozinha
        const telaSelecao = document.getElementById('tela-selecao-comanda');
        if (telaSelecao.style.display !== 'none') {
          carregarComandasAbertas();
        }
      }
    )
    .subscribe((status) => {
      console.log('[Realtime] status da inscrição em "comandas":', status);
    });
}

// ------------------------------------------------------------
// Cardápio
// ------------------------------------------------------------
async function carregarCardapio() {
  const { data: categorias, error } = await supabaseClient
    .from('categorias_cardapio')
    .select(`
      id, nome, ordem_exibicao,
      itens_cardapio (
        id, nome, descricao, preco_base, tipo_montagem, qtd_sabores_inclusos, preco_terceiro_sabor, destaque, disponivel, ordem_exibicao,
        item_ingredientes ( id, papel, preco_acrescimo, ingredientes ( id, nome ) )
      )
    `)
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .order('ordem_exibicao');

  if (error) {
    mostrarToast('Erro ao carregar cardápio.', 'erro');
    console.error(error);
    return;
  }

  estado.cardapio = categorias
    .map(cat => ({
      ...cat,
      itens_cardapio: (cat.itens_cardapio || [])
        .filter(i => i.disponivel)
        .sort((a, b) => a.ordem_exibicao - b.ordem_exibicao),
    }))
    .filter(cat => cat.itens_cardapio.length > 0)
    .sort((a, b) => a.ordem_exibicao - b.ordem_exibicao);

  renderCategorias();
}

function renderCategorias() {
  const nav = document.getElementById('nav-categorias');
  nav.innerHTML = estado.cardapio.map((cat, i) => `
    <button class="chip ${i === estado.categoriaAtivaIndex ? 'on' : ''}" onclick="selecionarCategoria(${i})">
      ${escapeHtml(cat.nome)}
    </button>
  `).join('');
  renderItens();
}

function selecionarCategoria(index) {
  estado.categoriaAtivaIndex = index;
  renderCategorias();
}

function renderItens() {
  const categoria = estado.cardapio[estado.categoriaAtivaIndex];
  const grid = document.getElementById('grid-itens');
  if (!categoria) { grid.innerHTML = ''; return; }

  grid.innerHTML = categoria.itens_cardapio.map(item => `
    <button class="item-card" onclick="abrirModalItem('${item.id}')">
      ${item.destaque ? '<span class="badge-destaque">Mais pedido</span>' : ''}
      <div class="item-nome">${escapeHtml(item.nome)}</div>
      ${item.descricao ? `<div class="item-descricao">${escapeHtml(item.descricao)}</div>` : ''}
      <div class="item-preco">R$ ${item.preco_base.toFixed(2).replace('.', ',')}</div>
    </button>
  `).join('');
}

function encontrarItem(itemId) {
  for (const cat of estado.cardapio) {
    const item = cat.itens_cardapio.find(i => i.id === itemId);
    if (item) return item;
  }
  return null;
}

// ------------------------------------------------------------
// Comandas
// ------------------------------------------------------------
async function carregarComandasAbertas() {
  const { data, error } = await supabaseClient
    .from('comandas')
    .select('id, numero_sequencial, tipo, numero_mesa, nome_cliente, identificador_pessoa, aberta_por, perfis(nome)')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .eq('status', 'aberta')
    .order('aberta_em', { ascending: false });

  if (error) { console.error(error); return; }

  const lista = document.getElementById('lista-comandas-abertas');
  if (!data || data.length === 0) {
    lista.innerHTML = '<div class="aviso-vazio">Nenhuma comanda aberta ainda.</div>';
    return;
  }

  lista.innerHTML = data.map(c => `
    <button class="comanda-card" onclick="selecionarComanda('${c.id}')">
      <span class="badge">${rotuloComanda(c)}</span>
      <span class="numero">${c.numero_sequencial ? `#${c.numero_sequencial}` : 'Sem pedido ainda'}</span>
      ${c.perfis?.nome ? `<span class="comanda-atendente">Atendente: ${escapeHtml(c.perfis.nome)}</span>` : ''}
    </button>
  `).join('');
}

function rotuloComanda(c) {
  if (c.tipo === 'mesa') {
    return c.identificador_pessoa ? `Mesa ${c.numero_mesa} · ${escapeHtml(c.identificador_pessoa)}` : `Mesa ${c.numero_mesa}`;
  }
  if (c.tipo === 'entrega') return `Entrega · ${escapeHtml(c.nome_cliente) || 'sem nome'}`;
  return escapeHtml(c.nome_cliente) || 'Balcão';
}

async function selecionarComanda(comandaId) {
  const { data, error } = await supabaseClient
    .from('comandas')
    .select('id, numero_sequencial, tipo, numero_mesa, nome_cliente, identificador_pessoa, endereco_entrega, telefone_contato')
    .eq('id', comandaId)
    .single();

  if (error || !data) { mostrarToast('Erro ao abrir comanda.', 'erro'); return; }

  estado.comandaAtual = data;
  estado.carrinho = [];
  mostrarTelaCardapio();
}

async function abrirNovaComandaMesa() {
  const numeroMesa = document.getElementById('input-numero-mesa').value.trim();
  const pessoa = formatarTitulo(document.getElementById('input-pessoa-mesa').value.trim());
  if (!numeroMesa) { mostrarToast('Digite o número da mesa.', 'erro'); return; }
  await criarComanda({ tipo: 'mesa', numero_mesa: numeroMesa, identificador_pessoa: pessoa || null });
}

async function abrirNovaComandaAvulsa() {
  const nomeCliente = formatarTitulo(document.getElementById('input-nome-cliente').value.trim());
  await criarComanda({ tipo: 'avulsa', nome_cliente: nomeCliente || null });
}

async function abrirNovaComandaEntrega() {
  const nomeCliente = formatarTitulo(document.getElementById('input-entrega-nome-cliente').value.trim());
  const telefone = document.getElementById('input-entrega-telefone').value.trim();
  const endereco = formatarTitulo(document.getElementById('input-entrega-endereco').value.trim());
  const taxaTexto = document.getElementById('input-entrega-taxa').value;

  if (!nomeCliente) { mostrarToast('Digite o nome do cliente.', 'erro'); return; }
  if (!endereco) { mostrarToast('Digite o endereço de entrega.', 'erro'); return; }

  const taxaEntrega = parseFloat((taxaTexto || '0').replace(',', '.')) || 0;

  await criarComanda({
    tipo: 'entrega',
    nome_cliente: nomeCliente,
    telefone_contato: telefone || null,
    endereco_entrega: endereco,
    taxa_entrega: taxaEntrega,
    status_entrega: 'preparando',
  });

  document.getElementById('input-entrega-nome-cliente').value = '';
  document.getElementById('input-entrega-telefone').value = '';
  document.getElementById('input-entrega-endereco').value = '';
  document.getElementById('input-entrega-taxa').value = '';
}

async function criarComanda(dados) {
  // O número só é atribuído no PRIMEIRO pedido enviado (não na abertura) —
  // assim a numeração reflete a ordem real de chegada na cozinha, não a
  // ordem que a mesa foi aberta no sistema
  const { data: comanda, error } = await supabaseClient
    .from('comandas')
    .insert({
      estabelecimento_id: estado.perfil.estabelecimento_id,
      aberta_por: estado.perfil.id,
      ...dados,
    })
    .select()
    .single();

  if (error) { mostrarToast('Erro ao abrir comanda.', 'erro'); console.error(error); return; }

  estado.comandaAtual = comanda;
  estado.carrinho = [];
  mostrarTelaCardapio();
}

function mostrarTelaCardapio() {
  document.getElementById('tela-selecao-comanda').style.display = 'none';
  document.getElementById('tela-cardapio').style.display = 'flex';

  // Garante que nada da comanda anterior "vaza" pra essa (carrinho e obs gerais)
  estado.observacoesGerais = [];
  const inputObsGeral = document.getElementById('input-obs-geral');
  if (inputObsGeral) inputObsGeral.value = '';

  const c = estado.comandaAtual;
  document.getElementById('titulo-comanda').textContent = rotuloComanda(c);
  document.getElementById('codigo-comanda').textContent = c.numero_sequencial ? `COMANDA #${c.numero_sequencial}` : 'AGUARDANDO 1º PEDIDO';

  const elEndereco = document.getElementById('endereco-entrega-aviso');
  if (c.tipo === 'entrega' && c.endereco_entrega) {
    const telefoneTexto = c.telefone_contato ? ` · 📞 ${c.telefone_contato}` : '';
    elEndereco.textContent = `📍 ${c.endereco_entrega}${telefoneTexto}`;
    elEndereco.style.display = 'block';
  } else {
    elEndereco.style.display = 'none';
  }

  renderCarrinho();
}

function voltarParaComandas() {
  document.getElementById('tela-cardapio').style.display = 'none';
  document.getElementById('tela-selecao-comanda').style.display = 'flex';
  estado.comandaAtual = null;

  // Limpa os campos de "nova comanda" — sem isso, ficavam com o texto
  // da última vez preenchido, dando impressão de que "já tinha salvo"
  document.getElementById('input-numero-mesa').value = '';
  document.getElementById('input-pessoa-mesa').value = '';
  document.getElementById('input-nome-cliente').value = '';
  document.getElementById('input-entrega-nome-cliente').value = '';
  document.getElementById('input-entrega-telefone').value = '';
  document.getElementById('input-entrega-endereco').value = '';
  document.getElementById('input-entrega-taxa').value = '';

  carregarComandasAbertas();
}

// ------------------------------------------------------------
// Modal de composição do item
// ------------------------------------------------------------
function abrirModalItem(itemId) {
  const item = encontrarItem(itemId);
  if (!item) return;

  estado.itemEmEdicao = item;
  estado.selecaoSabores = [];
  estado.ingredientesRemovidos = [];
  estado.acrescimosSelecionados = [];
  estado.observacaoAtual = '';

  document.getElementById('modal-item-nome').textContent = item.nome;
  document.getElementById('modal-item-preco-base').textContent = `R$ ${item.preco_base.toFixed(2).replace('.', ',')}`;

  renderCorpoModal();
  document.getElementById('modal-overlay').style.display = 'flex';
}

function fecharModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  estado.itemEmEdicao = null;
}

function renderCorpoModal() {
  const item = estado.itemEmEdicao;
  const corpo = document.getElementById('modal-corpo');
  let htmlEspecifico = '';

  if (item.tipo_montagem === 'fixo') {
    const padrao = item.item_ingredientes.filter(ii => ii.papel === 'padrao');
    const acrescimos = item.item_ingredientes.filter(ii => ii.papel === 'opcao');
    htmlEspecifico = `
      <div class="modal-secao-label">Ingredientes (toque para remover)</div>
      <div class="ing-list">
        ${padrao.map(ii => `
          <button class="chip ${estado.ingredientesRemovidos.includes(ii.ingredientes.id) ? 'off' : 'on'}"
                  onclick="alternarRemocao('${ii.ingredientes.id}')">
            ${escapeHtml(ii.ingredientes.nome)}
          </button>
        `).join('')}
      </div>
      ${acrescimos.length > 0 ? `
        <div class="modal-secao-label">Acréscimos (opcional)</div>
        <div class="ing-list">
          ${acrescimos.map(ii => renderChipAcrescimo(ii)).join('')}
        </div>
      ` : ''}
    `;
  } else if (item.tipo_montagem === 'monte_sabores') {
    const opcoes = item.item_ingredientes.filter(ii => ii.papel === 'opcao');
    htmlEspecifico = `
      <div class="modal-secao-label">Escolha ${item.qtd_sabores_inclusos} sabores (os próximos entram como acréscimo)</div>
      <div class="ing-list" id="lista-sabores-modal">
        ${opcoes.map(ii => renderChipSabor(ii)).join('')}
      </div>
    `;
  } else if (item.tipo_montagem === 'escolha_um') {
    const opcoes = item.item_ingredientes.filter(ii => ii.papel === 'opcao');
    htmlEspecifico = `
      <div class="modal-secao-label">Escolha 1 sabor</div>
      <div class="ing-list" id="lista-sabores-modal">
        ${opcoes.map(ii => renderChipSabor(ii, true)).join('')}
      </div>
    `;
  }

  // Observação livre — disponível em TODO tipo de item (ex: "com gelo e limão", "só gelo")
  // Usa estado.observacaoAtual (não lê da tela) — evita "vazar" texto de um item pro outro
  htmlEspecifico += `
    <div class="modal-secao-label">Observação (opcional)</div>
    <textarea id="modal-observacao-extra" rows="2"
      oninput="estado.observacaoAtual = this.value"
      placeholder="Ex: com gelo e limão, só gelo, cortar ao meio...">${escapeHtml(estado.observacaoAtual)}</textarea>
  `;

  corpo.innerHTML = htmlEspecifico;
  atualizarTotalModal();
}

function renderChipSabor(itemIngrediente, unico = false) {
  const id = itemIngrediente.ingredientes.id;
  const selecionado = estado.selecaoSabores.includes(id);
  const item = estado.itemEmEdicao;
  const posicao = estado.selecaoSabores.indexOf(id);
  // Só é "acréscimo de verdade" (vermelho) quando passa do 3º sabor —
  // o 3º em si (posição == cota) é o degrau especial, mas continua
  // sendo tratado como sabor normal (verde), não como acréscimo
  const foiAcrescimo = selecionado && !unico && posicao > item.qtd_sabores_inclusos;

  let classe = 'chip';
  let sufixo = '';
  if (selecionado && foiAcrescimo) {
    classe += ' extra';
    sufixo = ` +R$${itemIngrediente.preco_acrescimo.toFixed(2).replace('.', ',')}`;
  } else if (selecionado) {
    classe += ' on';
  }

  return `<button class="${classe}" onclick="alternarSabor('${id}', ${unico})">${itemIngrediente.ingredientes.nome}${sufixo}</button>`;
}

function alternarRemocao(ingredienteId) {
  const idx = estado.ingredientesRemovidos.indexOf(ingredienteId);
  if (idx >= 0) estado.ingredientesRemovidos.splice(idx, 1);
  else estado.ingredientesRemovidos.push(ingredienteId);
  renderCorpoModal();
}

function renderChipAcrescimo(itemIngrediente) {
  const id = itemIngrediente.ingredientes.id;
  const posicao = estado.acrescimosSelecionados.indexOf(id);
  const marcado = posicao >= 0;

  // Cada ingrediente removido libera 1 vaga de substituição grátis —
  // as primeiras marcações preenchem essa vaga (chip fica verde, sem
  // custo), só o que passar disso é acréscimo de verdade (chip vermelho)
  const vagasGratis = estado.ingredientesRemovidos.length;
  const ehSubstituicaoGratis = marcado && posicao < vagasGratis;

  const preco = itemIngrediente.preco_acrescimo.toFixed(2).replace('.', ',');
  const classeExtra = marcado ? (ehSubstituicaoGratis ? 'on' : 'extra') : '';
  const rotuloPreco = ehSubstituicaoGratis ? 'grátis' : `+R$${preco}`;

  return `
    <button class="chip ${classeExtra}" onclick="alternarAcrescimo('${id}')">
      ${itemIngrediente.ingredientes.nome} ${marcado ? rotuloPreco : `+R$${preco}`}
    </button>
  `;
}

function alternarAcrescimo(ingredienteId) {
  const idx = estado.acrescimosSelecionados.indexOf(ingredienteId);
  if (idx >= 0) estado.acrescimosSelecionados.splice(idx, 1);
  else estado.acrescimosSelecionados.push(ingredienteId);
  renderCorpoModal();
}

function alternarSabor(ingredienteId, unico) {
  if (unico) {
    estado.selecaoSabores = [ingredienteId];
  } else {
    const idx = estado.selecaoSabores.indexOf(ingredienteId);
    if (idx >= 0) estado.selecaoSabores.splice(idx, 1);
    else estado.selecaoSabores.push(ingredienteId);
  }
  renderCorpoModal();
}

function atualizarTotalModal() {
  const item = estado.itemEmEdicao;
  let total = item.preco_base;

  if (item.tipo_montagem === 'monte_sabores') {
    // Degrau especial: o sabor EXATAMENTE na posição da cota (o 3º, se a
    // cota for 2) cobra um valor fixo próprio — diferente do acréscimo
    // "normal" que se aplica só do 4º sabor em diante
    estado.selecaoSabores.forEach((id, pos) => {
      if (pos === item.qtd_sabores_inclusos) {
        total += Number(item.preco_terceiro_sabor || 0);
      } else if (pos > item.qtd_sabores_inclusos) {
        const ii = item.item_ingredientes.find(x => x.ingredientes.id === id);
        if (ii) total += ii.preco_acrescimo;
      }
    });
  }

  if (item.tipo_montagem === 'fixo') {
    // Cada ingrediente padrão removido libera 1 "vaga" de substituição
    // grátis — só o que passar dessas vagas é cobrado de verdade
    const vagasGratis = estado.ingredientesRemovidos.length;
    estado.acrescimosSelecionados.forEach((id, index) => {
      if (index >= vagasGratis) {
        const ii = item.item_ingredientes.find(x => x.ingredientes.id === id);
        if (ii) total += ii.preco_acrescimo;
      }
    });
  }

  document.getElementById('modal-total').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
}

function confirmarAdicaoAoCarrinho() {
  const item = estado.itemEmEdicao;
  let precoUnitario = item.preco_base;
  let observacao = null;
  let sabores = [];
  let nomeExibicao = item.nome;

  const obsExtra = (estado.observacaoAtual || '').trim();

  if (item.tipo_montagem === 'fixo') {
    const nomesRemovidos = item.item_ingredientes
      .filter(ii => estado.ingredientesRemovidos.includes(ii.ingredientes.id))
      .map(ii => ii.ingredientes.nome);
    const partes = [];
    if (nomesRemovidos.length) partes.push('Sem ' + nomesRemovidos.join(', '));
    if (obsExtra) partes.push(obsExtra);
    observacao = partes.length ? partes.join(' — ') : null;

    // Cada ingrediente removido libera 1 vaga de substituição grátis —
    // as primeiras adições preenchem essas vagas (sem custo), só o que
    // sobrar depois disso é cobrado como acréscimo de verdade
    const vagasGratis = nomesRemovidos.length;
    sabores = estado.acrescimosSelecionados.map((id, index) => {
      const ii = item.item_ingredientes.find(x => x.ingredientes.id === id);
      const ehSubstituicao = index < vagasGratis;
      if (!ehSubstituicao) precoUnitario += ii.preco_acrescimo;
      return {
        id,
        nome: ehSubstituicao ? `Substituído por ${ii.ingredientes.nome}` : `+ ${ii.ingredientes.nome}`,
        foiAcrescimo: !ehSubstituicao,
        foiSubstituicao: ehSubstituicao,
        precoAcrescimo: ehSubstituicao ? 0 : ii.preco_acrescimo,
      };
    });

  } else if (item.tipo_montagem === 'monte_sabores') {
    if (estado.selecaoSabores.length === 0) {
      mostrarToast('Escolha pelo menos 1 sabor.', 'erro');
      return;
    }
    sabores = estado.selecaoSabores.map((id, pos) => {
      const ii = item.item_ingredientes.find(x => x.ingredientes.id === id);
      if (pos === item.qtd_sabores_inclusos) {
        // É exatamente o sabor do "degrau" (ex: o 3º, numa cota de 2) —
        // cobra o valor fixo próprio dele, mas continua aparecendo como
        // sabor normal no cupom (não é tratado como "acréscimo")
        precoUnitario += Number(item.preco_terceiro_sabor || 0);
        return { id, nome: ii.ingredientes.nome, foiAcrescimo: false, foiSubstituicao: false, precoAcrescimo: Number(item.preco_terceiro_sabor || 0) };
      }
      if (pos > item.qtd_sabores_inclusos) {
        // Além do degrau (ex: o 4º sabor) — aí sim é acréscimo de verdade
        precoUnitario += ii.preco_acrescimo;
        return { id, nome: ii.ingredientes.nome, foiAcrescimo: true, foiSubstituicao: false, precoAcrescimo: ii.preco_acrescimo };
      }
      return { id, nome: ii.ingredientes.nome, foiAcrescimo: false, foiSubstituicao: false, precoAcrescimo: 0 };
    });
    observacao = obsExtra || null;

    // Nome dinâmico: "— 2 sabores" ou "— 3 sabores" (trava em 3, mesmo
    // que a pessoa escolha um 4º — esse 4º vira só um acréscimo à parte)
    const qtdParaNome = Math.min(estado.selecaoSabores.length, item.qtd_sabores_inclusos + 1);
    nomeExibicao = `${item.nome} — ${qtdParaNome} sabores`;

  } else if (item.tipo_montagem === 'escolha_um') {
    if (estado.selecaoSabores.length === 0) {
      mostrarToast('Escolha 1 sabor.', 'erro');
      return;
    }
    const id = estado.selecaoSabores[0];
    const ii = item.item_ingredientes.find(x => x.ingredientes.id === id);
    sabores = [{ id, nome: ii.ingredientes.nome, foiAcrescimo: false, foiSubstituicao: false, precoAcrescimo: 0 }];
    observacao = obsExtra || null;

  } else {
    // venda_direta
    observacao = obsExtra || null;
  }

  adicionarAoCarrinho({ item, nomeExibicao, precoUnitario, observacao, sabores });
  fecharModal();
}

// ------------------------------------------------------------
// Carrinho
// ------------------------------------------------------------
function chaveLinha(linha) {
  const saboresOrdenados = linha.sabores.map(s => s.id).sort().join(',');
  return `${linha.item.id}|${linha.observacao || ''}|${saboresOrdenados}`;
}

function adicionarAoCarrinho(linha) {
  const chave = chaveLinha(linha);
  const existente = estado.carrinho.find(l => chaveLinha(l) === chave);
  if (existente) {
    existente.quantidade += 1;
  } else {
    estado.carrinho.push({ ...linha, quantidade: 1 });
  }
  renderCarrinho();
  mostrarToast(`${linha.item.nome} adicionado`);
}

function removerDoCarrinho(index) {
  estado.carrinho.splice(index, 1);
  renderCarrinho();
}

function renderCarrinho() {
  const lista = document.getElementById('carrinho-lista');
  const total = estado.carrinho.reduce((soma, l) => soma + l.precoUnitario * l.quantidade, 0);

  if (estado.carrinho.length === 0) {
    lista.innerHTML = '<div class="aviso-vazio">Carrinho vazio</div>';
  } else {
    lista.innerHTML = estado.carrinho.map((l, i) => `
      <div class="carrinho-linha">
        <div>
          <div class="carrinho-linha-nome">${l.quantidade}× ${escapeHtml(l.nomeExibicao || l.item.nome)}</div>
          ${l.sabores.length ? `<div class="carrinho-linha-obs">${l.sabores.map(s => escapeHtml(s.nome)).join(', ')}</div>` : ''}
          ${l.observacao ? `<div class="carrinho-linha-obs">${escapeHtml(l.observacao)}</div>` : ''}
        </div>
        <div class="carrinho-linha-direita">
          <span>R$ ${(l.precoUnitario * l.quantidade).toFixed(2).replace('.', ',')}</span>
          <button class="btn-remover" onclick="removerDoCarrinho(${i})">✕</button>
        </div>
      </div>
    `).join('');
  }

  renderObsGerais();

  document.getElementById('carrinho-total').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
  document.getElementById('btn-enviar-pedido').disabled = estado.carrinho.length === 0;
}

function adicionarObsGeral() {
  const input = document.getElementById('input-obs-geral');
  const texto = input.value.trim();
  if (!texto) return;
  estado.observacoesGerais.push(texto);
  input.value = '';
  renderObsGerais();
}

function removerObsGeral(index) {
  estado.observacoesGerais.splice(index, 1);
  renderObsGerais();
}

function renderObsGerais() {
  const lista = document.getElementById('lista-obs-gerais');
  lista.innerHTML = estado.observacoesGerais.map((texto, i) => `
    <div class="obs-geral-item">
      <span>${escapeHtml(texto)}</span>
      <button class="btn-remover" onclick="removerObsGeral(${i})">✕</button>
    </div>
  `).join('');
}

async function enviarPedido() {
  if (estado.carrinho.length === 0) return;
  const btn = document.getElementById('btn-enviar-pedido');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    // Só deixa enviar pedido se o caixa do turno estiver aberto — isso
    // garante que todo pedido sempre acontece dentro de um ciclo de
    // caixa, com numeração e conferência batendo direitinho no final
    const { count: qtdCaixaAberto, error: erroCaixa } = await supabaseClient
      .from('caixas_turno')
      .select('id', { count: 'exact', head: true })
      .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
      .eq('status', 'aberto');

    if (erroCaixa) throw erroCaixa;

    if (!qtdCaixaAberto) {
      mostrarToast('O caixa ainda não foi aberto hoje. Peça pro caixa abrir primeiro (mesmo que sem troco).', 'erro');
      return;
    }

    // Se essa comanda ainda não tem número (é o primeiro pedido dela),
    // atribui agora — ANTES de mandar os itens, pra já sair certo no
    // cupom da cozinha, sem risco de corrida entre as duas ações
    if (!estado.comandaAtual.numero_sequencial) {
      const { data: numero, error: erroNumero } = await supabaseClient
        .rpc('fn_proximo_numero_comanda', { p_estabelecimento_id: estado.perfil.estabelecimento_id });

      if (erroNumero) throw erroNumero;

      const { error: erroUpdate } = await supabaseClient
        .from('comandas')
        .update({ numero_sequencial: numero })
        .eq('id', estado.comandaAtual.id);

      if (erroUpdate) throw erroUpdate;

      estado.comandaAtual.numero_sequencial = numero;
    }

    for (const linha of estado.carrinho) {
      const { data: pedidoItem, error } = await supabaseClient
        .from('pedido_itens')
        .insert({
          comanda_id: estado.comandaAtual.id,
          item_cardapio_id: linha.item.id,
          quantidade: linha.quantidade,
          preco_unitario_calculado: linha.precoUnitario,
          observacao: linha.observacao,
          status: 'enviado',
          criado_por: estado.perfil.id,
        })
        .select()
        .single();

      if (error) throw error;

      if (linha.sabores.length > 0) {
        const linhasSabores = linha.sabores.map(s => ({
          pedido_item_id: pedidoItem.id,
          ingrediente_id: s.id,
          foi_acrescimo: s.foiAcrescimo,
          foi_substituicao: s.foiSubstituicao || false,
          preco_acrescimo_aplicado: s.precoAcrescimo,
        }));
        const { error: erroSabores } = await supabaseClient
          .from('pedido_item_ingredientes')
          .insert(linhasSabores);
        if (erroSabores) throw erroSabores;
      }
    }

    // Observações gerais do pedido (ex: "3 copos com limão e gelo") — linhas separadas, não ligadas a item
    if (estado.observacoesGerais.length > 0) {
      const linhasObs = estado.observacoesGerais.map(texto => ({
        comanda_id: estado.comandaAtual.id,
        texto,
        status: 'enviado',
        criado_por: estado.perfil.id,
      }));
      const { error: erroObs } = await supabaseClient
        .from('comanda_observacoes')
        .insert(linhasObs);
      if (erroObs) throw erroObs;
    }

    mostrarToast('Pedido enviado pra cozinha! 🔥');
    estado.carrinho = [];
    estado.observacoesGerais = [];

    // Volta pra tela inicial automaticamente, já com tudo limpo —
    // pedido feito, atendente já pode atender a próxima mesa
    voltarParaComandas();

  } catch (erro) {
    console.error(erro);
    mostrarToast('Erro ao enviar pedido. Tente de novo.', 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = '↳ Enviar pedido pra cozinha';
  }
}

// ------------------------------------------------------------
// Pedidos já enviados (prévia do que vai sair no cupom da cozinha)
// ------------------------------------------------------------
async function abrirPedidosEnviados() {
  document.getElementById('modal-pedidos-overlay').style.display = 'flex';
  const lista = document.getElementById('lista-pedidos-enviados');
  lista.innerHTML = '<div class="aviso-vazio">Carregando...</div>';

  const [{ data: itens, error: erroItens }, { data: obsGerais, error: erroObs }] = await Promise.all([
    supabaseClient
      .from('pedido_itens')
      .select(`
        id, quantidade, preco_unitario_calculado, observacao, status, criado_em, criado_por,
        perfis ( nome ),
        itens_cardapio ( nome, tipo_montagem ),
        pedido_item_ingredientes ( foi_acrescimo, foi_substituicao, ingredientes ( nome ) )
      `)
      .eq('comanda_id', estado.comandaAtual.id)
      .neq('status', 'cancelado')
      .order('criado_em', { ascending: true }),
    supabaseClient
      .from('comanda_observacoes')
      .select('id, texto, status, criado_em')
      .eq('comanda_id', estado.comandaAtual.id)
      .order('criado_em', { ascending: true }),
  ]);

  if (erroItens || erroObs) {
    lista.innerHTML = '<div class="aviso-vazio">Erro ao carregar pedidos.</div>';
    console.error(erroItens || erroObs);
    return;
  }

  // Guarda a lista buscada — os botões de cancelar usam isso pra achar
  // o nome do item, em vez de tentar colocar texto solto dentro do onclick
  // (o que causava erro quando o nome do item tinha acento/aspas)
  estado.ultimosPedidosEnviados = itens || [];

  const htmlBotaoConferencia = `
    <button class="btn-ghost" style="width:100%; margin-bottom:14px;" onclick="imprimirConferencia()">
      🖨️ Imprimir conferência (não fecha a conta)
    </button>
  `;

  if ((!itens || itens.length === 0) && (!obsGerais || obsGerais.length === 0)) {
    lista.innerHTML = htmlBotaoConferencia + '<div class="aviso-vazio">Nenhum pedido enviado ainda pra essa comanda.</div>';
    return;
  }

  const htmlItens = agruparPedidosPorLeva(itens || []).map(leva => {
    const horario = new Date(leva.primeiroTempo).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const cabecalho = leva.nomeAtendente ? `${horario} · Atendente: ${escapeHtml(leva.nomeAtendente)}` : horario;

    const htmlItensLeva = leva.itens.map(pi => {
      const saboresNormais = pi.pedido_item_ingredientes.filter(s => !s.foi_acrescimo && !s.foi_substituicao).map(s => escapeHtml(s.ingredientes.nome)).join(', ');
      const substituicoes = pi.pedido_item_ingredientes.filter(s => s.foi_substituicao).map(s => escapeHtml(s.ingredientes.nome)).join(', ');
      const acrescimos = pi.pedido_item_ingredientes.filter(s => s.foi_acrescimo).map(s => escapeHtml(s.ingredientes.nome)).join(', ');

      // Nome dinâmico pro Monte-sabores: "— 2 sabores" ou "— 3 sabores",
      // igual à regra usada na hora de montar o carrinho
      let nomeItem = pi.itens_cardapio.nome;
      if (pi.itens_cardapio.tipo_montagem === 'monte_sabores') {
        const qtdParaNome = pi.pedido_item_ingredientes.filter(s => !s.foi_acrescimo).length;
        nomeItem = `${nomeItem} — ${qtdParaNome} sabores`;
      }

      // Só permite cancelar se ainda não foi entregue (ainda dá tempo de avisar a cozinha)
      const podeCancel = pi.status === 'enviado' || pi.status === 'impresso';
      return `
        <div class="pedido-enviado-linha">
          <div class="linha-topo">
            <span>${pi.quantidade}× ${escapeHtml(nomeItem)}</span>
            <span>R$ ${(pi.preco_unitario_calculado * pi.quantidade).toFixed(2).replace('.', ',')}</span>
          </div>
          ${saboresNormais ? `<div class="linha-detalhe">${saboresNormais}</div>` : ''}
          ${pi.observacao ? `<div class="linha-detalhe">${escapeHtml(pi.observacao)}</div>` : ''}
          ${substituicoes ? `<div class="linha-detalhe">Substituído por: ${substituicoes}</div>` : ''}
          ${acrescimos ? `<div class="linha-detalhe">+ ACRÉSCIMO: ${acrescimos}</div>` : ''}
          <span class="linha-status">${pi.status}</span>
          ${podeCancel ? `<button class="btn-cancelar-item" onclick="cancelarItemEnviado('${pi.id}')">Cancelar item</button>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="leva-pedido">
        <div class="leva-cabecalho">${cabecalho}</div>
        ${htmlItensLeva}
      </div>
    `;
  }).join('');

  const htmlObs = (obsGerais || []).map(o => `
    <div class="obs-geral-enviada">📝 ${escapeHtml(o.texto)}</div>
  `).join('');

  lista.innerHTML = htmlBotaoConferencia + htmlItens + htmlObs;
}

// Agrupa os itens enviados em "levas" (uma leva = uma ação de "enviar
// pedido"). Como cada item é salvo com um insert separado, os horários
// não são idênticos — então agrupamos por: mesmo atendente + item
// enviado a até 10s do anterior da mesma leva
function agruparPedidosPorLeva(itens) {
  const levas = [];
  let levaAtual = null;

  for (const item of itens) {
    const tempo = new Date(item.criado_em).getTime();
    const mesmoAtendente = levaAtual && item.criado_por === levaAtual.criadoPor;
    const dentroDaJanela = levaAtual && (tempo - levaAtual.ultimoTempo) < 10000;

    if (mesmoAtendente && dentroDaJanela) {
      levaAtual.itens.push(item);
      levaAtual.ultimoTempo = tempo;
    } else {
      levaAtual = {
        criadoPor: item.criado_por,
        nomeAtendente: item.perfis?.nome,
        primeiroTempo: tempo,
        ultimoTempo: tempo,
        itens: [item],
      };
      levas.push(levaAtual);
    }
  }

  return levas;
}

async function cancelarItemEnviado(pedidoItemId) {
  const item = estado.ultimosPedidosEnviados.find(pi => pi.id === pedidoItemId);
  if (!item) return;

  const nomeItem = `${item.quantidade}× ${item.itens_cardapio.nome}`;

  mostrarConfirmacaoGenerica(
    `Cancelar "${nomeItem}"? A cozinha será avisada pra não produzir (ou parar, se já estiver em andamento).`,
    async () => {
      const { error: erroCancelar } = await supabaseClient
        .from('pedido_itens')
        .update({ status: 'cancelado' })
        .eq('id', pedidoItemId);

      if (erroCancelar) {
        mostrarToast('Erro ao cancelar item.', 'erro');
        return;
      }

      // Reimprime o pedido da cozinha atualizado (sem o item cancelado),
      // pra cozinha ver exatamente o que continua valendo
      await supabaseClient.from('solicitacoes_impressao').insert({
        comanda_id: estado.comandaAtual.id,
        tipo: 'pedido_atualizado',
        criado_por: estado.perfil.id,
      });

      mostrarToast('Item cancelado e cozinha avisada.');
      abrirPedidosEnviados(); // recarrega a lista
    }
  );
}

async function imprimirConferencia() {
  const { error } = await supabaseClient.from('solicitacoes_impressao').insert({
    comanda_id: estado.comandaAtual.id,
    tipo: 'conferencia',
    criado_por: estado.perfil.id,
  });

  if (error) {
    mostrarToast('Erro ao pedir impressão.', 'erro');
    return;
  }
  mostrarToast('Conferência enviada pra impressão! 🖨️');
}

function fecharPedidosEnviados() {
  document.getElementById('modal-pedidos-overlay').style.display = 'none';
}

// ------------------------------------------------------------
// Cancelar comanda inteira (cliente desistiu antes de fechar)
// ------------------------------------------------------------
function abrirConfirmacaoCancelarComanda() {
  mostrarConfirmacaoGenerica(
    `Cancelar a comanda inteira "${rotuloComanda(estado.comandaAtual)}"? Todos os itens serão cancelados e ela não vai contar como venda.`,
    async () => {
      const comandaId = estado.comandaAtual.id;

      // Cancela todos os itens ainda ativos dessa comanda
      await supabaseClient
        .from('pedido_itens')
        .update({ status: 'cancelado' })
        .eq('comanda_id', comandaId)
        .neq('status', 'cancelado');

      // Marca a comanda como cancelada (some da lista, não conta no financeiro)
      const { error } = await supabaseClient
        .from('comandas')
        .update({ status: 'cancelada' })
        .eq('id', comandaId);

      if (error) {
        mostrarToast('Erro ao cancelar comanda.', 'erro');
        return;
      }

      mostrarToast('Comanda cancelada.');
      fecharPedidosEnviados();
      voltarParaComandas();
    }
  );
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

iniciar();
