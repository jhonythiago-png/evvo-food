// ============================================================
// Evvo Food — Gerenciar Cardápio (Master)
// ============================================================

const estado = {
  perfil: null,
  categorias: [],
  itens: [],
  ingredientes: [],
  itemEmEdicaoId: null, // null = criando novo
  vinculosAtuais: {},    // { ingrediente_id: { selecionado, precoAcrescimo } } — só enquanto o modal do item está aberto
};

const NOMES_TIPO = {
  fixo: 'Fixo (ingredientes prontos)',
  monte_sabores: 'Monte-sabores (escolhe N)',
  escolha_um: 'Escolha 1 sabor',
  venda_direta: 'Venda direta (sem sabor)',
};

async function iniciar() {
  estado.perfil = await verificarAutenticacao();
  if (!estado.perfil) return;

  if (estado.perfil.nivel_acesso !== 'master') {
    document.body.className = '';
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

  injetarNavegacao(estado.perfil, 'cardapio');
  await carregarCategorias();
  await carregarIngredientes();
  await carregarItens();
}

// ------------------------------------------------------------
// Categorias
// ------------------------------------------------------------
async function carregarCategorias() {
  const { data, error } = await supabaseClient
    .from('categorias_cardapio')
    .select('id, nome, ordem_exibicao')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .order('ordem_exibicao');

  if (error) { console.error(error); return; }

  estado.categorias = data || [];
  renderCategorias();
  preencherSelectCategorias();
}

function renderCategorias() {
  const container = document.getElementById('lista-categorias');

  if (estado.categorias.length === 0) {
    container.innerHTML = '<div class="aviso-vazio-pequeno">Nenhuma categoria ainda.</div>';
    return;
  }

  container.innerHTML = estado.categorias.map(c => `
    <div class="categoria-linha">
      <input type="text" value="${escapeHtml(c.nome)}" onchange="renomearCategoria('${c.id}', this.value)">
      <input type="number" class="categoria-ordem" value="${c.ordem_exibicao}" onchange="reordenarCategoria('${c.id}', this.value)" title="Ordem de exibição">
    </div>
  `).join('');
}

function preencherSelectCategorias() {
  const select = document.getElementById('input-item-categoria');
  if (!select) return;
  select.innerHTML = estado.categorias.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
}

async function renomearCategoria(id, novoNome) {
  const nomeFormatado = formatarTitulo(novoNome);
  if (!nomeFormatado) return;
  const { error } = await supabaseClient.from('categorias_cardapio').update({ nome: nomeFormatado }).eq('id', id);
  if (error) { mostrarToast('Erro ao renomear categoria.', 'erro'); return; }
  mostrarToast('Categoria atualizada.');
  await carregarCategorias();
  await carregarItens();
}

async function reordenarCategoria(id, novaOrdem) {
  const { error } = await supabaseClient.from('categorias_cardapio').update({ ordem_exibicao: parseInt(novaOrdem) || 0 }).eq('id', id);
  if (error) { mostrarToast('Erro ao reordenar.', 'erro'); return; }
  await carregarCategorias();
  await carregarItens();
}

async function criarNovaCategoria() {
  const nome = formatarTitulo(document.getElementById('input-nova-categoria').value.trim());
  if (!nome) { mostrarToast('Digite o nome da categoria.', 'erro'); return; }

  const proximaOrdem = estado.categorias.length > 0
    ? Math.max(...estado.categorias.map(c => c.ordem_exibicao)) + 1
    : 1;

  const { error } = await supabaseClient.from('categorias_cardapio').insert({
    estabelecimento_id: estado.perfil.estabelecimento_id,
    nome,
    ordem_exibicao: proximaOrdem,
  });

  if (error) { mostrarToast('Erro ao criar categoria.', 'erro'); return; }

  document.getElementById('input-nova-categoria').value = '';
  mostrarToast('Categoria criada!');
  await carregarCategorias();
}

// ------------------------------------------------------------
// Ingredientes / sabores
// ------------------------------------------------------------
async function carregarIngredientes() {
  const { data, error } = await supabaseClient
    .from('ingredientes')
    .select('id, nome, disponivel')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .order('nome');

  if (error) { console.error(error); return; }

  estado.ingredientes = data || [];
  renderIngredientes();
}

function renderIngredientes() {
  const container = document.getElementById('lista-ingredientes');

  if (estado.ingredientes.length === 0) {
    container.innerHTML = '<div class="aviso-vazio-pequeno">Nenhum ingrediente cadastrado ainda.</div>';
    return;
  }

  container.innerHTML = estado.ingredientes.map(ing => `
    <div class="ingrediente-chip ${!ing.disponivel ? 'indisponivel' : ''}">
      <span class="ingrediente-nome-clicavel" onclick="abrirModalIngrediente('${ing.id}')">${escapeHtml(ing.nome)}</span>
      <label class="switch-disponivel switch-mini" title="Disponível">
        <input type="checkbox" ${ing.disponivel ? 'checked' : ''} onchange="alternarDisponibilidadeIngrediente('${ing.id}', this.checked)">
        <span class="switch-slider"></span>
      </label>
    </div>
  `).join('');
}

async function alternarDisponibilidadeIngrediente(id, novoValor) {
  const { error } = await supabaseClient.from('ingredientes').update({ disponivel: novoValor }).eq('id', id);
  if (error) { mostrarToast('Erro ao atualizar ingrediente.', 'erro'); return; }
  await carregarIngredientes();
}

async function criarNovoIngrediente() {
  const nome = formatarTitulo(document.getElementById('input-novo-ingrediente').value.trim());
  if (!nome) { mostrarToast('Digite o nome do ingrediente.', 'erro'); return; }

  const { error } = await supabaseClient.from('ingredientes').insert({
    estabelecimento_id: estado.perfil.estabelecimento_id,
    nome,
  });

  if (error) {
    mostrarToast(error.code === '23505' ? 'Esse ingrediente já existe.' : 'Erro ao criar ingrediente.', 'erro');
    return;
  }

  document.getElementById('input-novo-ingrediente').value = '';
  mostrarToast('Ingrediente criado!');
  await carregarIngredientes();
}

let ingredienteEmEdicaoId = null;

function abrirModalIngrediente(id) {
  const ing = estado.ingredientes.find(i => i.id === id);
  if (!ing) return;

  ingredienteEmEdicaoId = id;
  document.getElementById('input-edit-ingrediente-nome').value = ing.nome;
  document.getElementById('input-edit-ingrediente-disponivel').checked = ing.disponivel;
  document.getElementById('modal-ingrediente-overlay').style.display = 'flex';
}

function fecharModalIngrediente() {
  document.getElementById('modal-ingrediente-overlay').style.display = 'none';
  ingredienteEmEdicaoId = null;
}

async function salvarIngrediente() {
  const nome = formatarTitulo(document.getElementById('input-edit-ingrediente-nome').value.trim());
  const disponivel = document.getElementById('input-edit-ingrediente-disponivel').checked;

  if (!nome) { mostrarToast('Digite o nome do ingrediente.', 'erro'); return; }

  const { error } = await supabaseClient
    .from('ingredientes')
    .update({ nome, disponivel })
    .eq('id', ingredienteEmEdicaoId);

  if (error) {
    mostrarToast(error.code === '23505' ? 'Já existe um ingrediente com esse nome.' : 'Erro ao salvar.', 'erro');
    return;
  }

  mostrarToast('Ingrediente atualizado!');
  fecharModalIngrediente();
  await carregarIngredientes();
}

async function excluirIngrediente() {
  const confirmar = confirm('Excluir esse ingrediente de vez?');
  if (!confirmar) return;

  const { error } = await supabaseClient.from('ingredientes').delete().eq('id', ingredienteEmEdicaoId);

  if (error) {
    mostrarToast('Esse ingrediente já está sendo usado em algum item ou pedido — desative em vez de excluir.', 'erro');
    return;
  }

  mostrarToast('Ingrediente excluído.');
  fecharModalIngrediente();
  await carregarIngredientes();
}

// ------------------------------------------------------------
// Itens do cardápio
// ------------------------------------------------------------
async function carregarItens() {
  const { data, error } = await supabaseClient
    .from('itens_cardapio')
    .select('id, nome, descricao, preco_base, tipo_montagem, qtd_sabores_inclusos, preco_terceiro_sabor, imprime_em, destaque, disponivel, ordem_exibicao, categoria_id, categorias_cardapio(nome, ordem_exibicao)')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .order('ordem_exibicao');

  if (error) { console.error(error); return; }

  estado.itens = data || [];
  renderItens();
}

function renderItens() {
  const container = document.getElementById('lista-itens');

  if (estado.itens.length === 0) {
    container.innerHTML = '<div class="aviso-vazio-pequeno">Nenhum item cadastrado ainda.</div>';
    return;
  }

  // Agrupa por categoria, na ordem de exibição da categoria
  const porCategoria = {};
  for (const item of estado.itens) {
    const catNome = item.categorias_cardapio?.nome || '(sem categoria)';
    const catOrdem = item.categorias_cardapio?.ordem_exibicao ?? 999;
    if (!porCategoria[catNome]) porCategoria[catNome] = { ordem: catOrdem, itens: [] };
    porCategoria[catNome].itens.push(item);
  }

  const categoriasOrdenadas = Object.entries(porCategoria).sort((a, b) => a[1].ordem - b[1].ordem);

  container.innerHTML = categoriasOrdenadas.map(([catNome, dados]) => `
    <div class="grupo-categoria">
      <div class="grupo-categoria-titulo">${escapeHtml(catNome)}</div>
      ${dados.itens.map(item => `
        <div class="item-linha ${!item.disponivel ? 'indisponivel' : ''}">
          <div class="item-linha-clicavel" onclick="abrirModalItem('${item.id}')">
            <div class="item-linha-nome">
              ${escapeHtml(item.nome)}
              ${item.destaque ? '<span class="badge-destaque-mini">destaque</span>' : ''}
            </div>
            <div class="item-linha-detalhe">${NOMES_TIPO[item.tipo_montagem]} · R$ ${Number(item.preco_base).toFixed(2).replace('.', ',')}</div>
          </div>
          <label class="switch-disponivel" title="Disponível">
            <input type="checkbox" ${item.disponivel ? 'checked' : ''} onchange="alternarDisponibilidade('${item.id}', this.checked)">
            <span class="switch-slider"></span>
          </label>
        </div>
      `).join('')}
    </div>
  `).join('');
}

async function alternarDisponibilidade(itemId, novoValor) {
  const { error } = await supabaseClient.from('itens_cardapio').update({ disponivel: novoValor }).eq('id', itemId);
  if (error) { mostrarToast('Erro ao atualizar disponibilidade.', 'erro'); return; }
  mostrarToast(novoValor ? 'Item disponível.' : 'Item marcado como indisponível.');
  await carregarItens();
}

// ------------------------------------------------------------
// Modal de item (criar/editar)
// ------------------------------------------------------------
function abrirModalItem(itemId) {
  estado.itemEmEdicaoId = itemId || null;
  const item = itemId ? estado.itens.find(i => i.id === itemId) : null;

  document.getElementById('modal-item-titulo').textContent = item ? 'Editar item' : 'Novo item';
  document.getElementById('input-item-nome').value = item?.nome || '';
  document.getElementById('input-item-descricao').value = item?.descricao || '';
  document.getElementById('input-item-preco').value = item ? String(item.preco_base).replace('.', ',') : '';
  document.getElementById('input-item-categoria').value = item?.categoria_id || (estado.categorias[0]?.id || '');
  document.getElementById('input-item-tipo').value = item?.tipo_montagem || 'fixo';
  document.getElementById('input-item-qtd-sabores').value = item?.qtd_sabores_inclusos || '';
  // Mostra o valor TOTAL com 3 sabores (preço base + o degrau), não a
  // diferença crua — é mais intuitivo pra editar depois
  const totalTresSabores = item ? Number(item.preco_base) + Number(item.preco_terceiro_sabor || 0) : null;
  document.getElementById('input-item-preco-terceiro-sabor').value = totalTresSabores ? String(totalTresSabores.toFixed(2)).replace('.', ',') : '';
  document.getElementById('input-item-imprime-em').value = item?.imprime_em || 'cozinha';
  document.getElementById('input-item-destaque').checked = item?.destaque || false;
  document.getElementById('input-item-disponivel').checked = item ? item.disponivel : true;

  estado.vinculosAtuais = {};
  document.getElementById('btn-excluir-item').style.display = item ? 'block' : 'none';
  document.getElementById('modal-item-overlay').style.display = 'flex';

  if (item) {
    carregarVinculosIngredientes(itemId);
  } else {
    atualizarVisibilidadeQtdSabores();
  }
}

async function carregarVinculosIngredientes(itemId) {
  const { data, error } = await supabaseClient
    .from('item_ingredientes')
    .select('ingrediente_id, papel, preco_acrescimo')
    .eq('item_id', itemId);

  if (!error) {
    estado.vinculosAtuais = {};
    for (const v of data || []) {
      estado.vinculosAtuais[v.ingrediente_id] = { selecionado: true, papel: v.papel, precoAcrescimo: v.preco_acrescimo };
    }
  }
  atualizarVisibilidadeQtdSabores();
}

function fecharModalItem() {
  document.getElementById('modal-item-overlay').style.display = 'none';
}

function atualizarVisibilidadeQtdSabores() {
  const tipo = document.getElementById('input-item-tipo').value;
  const precisa = tipo === 'monte_sabores' || tipo === 'escolha_um';
  document.getElementById('campo-qtd-sabores').style.display = precisa ? 'block' : 'none';
  if (tipo === 'escolha_um') document.getElementById('input-item-qtd-sabores').value = 1;

  // O "degrau do 3º sabor" só faz sentido pro Monte-sabores — Escolha 1
  // não tem essa lógica de cota subindo aos poucos
  document.getElementById('campo-preco-terceiro-sabor').style.display = tipo === 'monte_sabores' ? 'block' : 'none';

  renderSecaoIngredientesModal();
}

/**
 * Mostra os ingredientes disponíveis pra vincular a esse item.
 * - 'fixo': DUAS listas — padrão (inclusos, removíveis sem custo) e
 *   acréscimos (opcionais, com preço) — ex: Frango Especial pode ter
 *   Bacon como padrão E ainda permitir "Catupiry extra" com custo.
 * - 'monte_sabores': lista única de sabores disponíveis, cada um com
 *   o preço cobrado SE for escolhido além da cota.
 * - 'escolha_um': lista única, sem preço (só troca o sabor).
 * - 'venda_direta': não mostra nada.
 */
function renderSecaoIngredientesModal() {
  const tipo = document.getElementById('input-item-tipo').value;
  const secao = document.getElementById('secao-ingredientes-item');

  if (tipo === 'venda_direta') {
    secao.style.display = 'none';
    return;
  }
  secao.style.display = 'block';

  let html = '';

  if (tipo === 'fixo') {
    html += `<div class="ingredientes-subsecao-label">Ingredientes padrão (inclusos — cliente pode pedir pra remover, sem custo)</div>`;
    html += renderChecklistIngredientes('padrao', false);
    html += `<div class="ingredientes-subsecao-label" style="margin-top:16px;">Acréscimos disponíveis (opcional, com custo extra)</div>`;
    html += renderChecklistIngredientes('opcao', true);
  } else if (tipo === 'monte_sabores') {
    html += `<div class="ingredientes-subsecao-label">Sabores disponíveis (cota inclusa já foi definida acima; o que passar da cota cobra o preço aqui)</div>`;
    html += renderChecklistIngredientes('opcao', true);
  } else if (tipo === 'escolha_um') {
    html += `<div class="ingredientes-subsecao-label">Sabores disponíveis pra escolher (sem custo extra)</div>`;
    html += renderChecklistIngredientes('opcao', false);
  }

  document.getElementById('lista-ingredientes-modal').innerHTML = html;
}

function renderChecklistIngredientes(papelAlvo, mostrarPreco) {
  return `<div class="lista-ingredientes-modal-interna">` + estado.ingredientes.map(ing => {
    const v = estado.vinculosAtuais[ing.id];
    const marcado = v?.selecionado && v.papel === papelAlvo;
    const preco = marcado ? v.precoAcrescimo : 0;
    return `
      <div class="ingrediente-modal-linha">
        <label class="ingrediente-modal-check">
          <input type="checkbox" ${marcado ? 'checked' : ''}
                 onchange="alternarIngredienteModal('${ing.id}', this.checked, '${papelAlvo}')">
          <span>${escapeHtml(ing.nome)}</span>
        </label>
        ${mostrarPreco ? `
          <input type="text" inputmode="decimal" class="ingrediente-modal-preco"
                 placeholder="0,00" value="${marcado ? String(preco).replace('.', ',') : ''}"
                 ${marcado ? '' : 'disabled'}
                 onchange="atualizarPrecoIngredienteModal('${ing.id}', this.value)">
        ` : ''}
      </div>
    `;
  }).join('') + `</div>`;
}

function alternarIngredienteModal(ingredienteId, marcado, papelAlvo) {
  if (marcado) {
    estado.vinculosAtuais[ingredienteId] = {
      selecionado: true,
      papel: papelAlvo,
      precoAcrescimo: estado.vinculosAtuais[ingredienteId]?.precoAcrescimo || 0,
    };
  } else if (estado.vinculosAtuais[ingredienteId]?.papel === papelAlvo) {
    // só desmarca se o clique foi na mesma lista onde ele estava marcado
    // (evita que marcar numa lista desmarque por engano na outra)
    delete estado.vinculosAtuais[ingredienteId];
  }
  renderSecaoIngredientesModal();
}

function atualizarPrecoIngredienteModal(ingredienteId, valor) {
  const preco = parseFloat(valor.replace(',', '.')) || 0;
  if (estado.vinculosAtuais[ingredienteId]) {
    estado.vinculosAtuais[ingredienteId].precoAcrescimo = preco;
  }
}

async function salvarItem() {
  const nome = formatarTitulo(document.getElementById('input-item-nome').value.trim());
  const descricao = formatarPrimeiraLetra(document.getElementById('input-item-descricao').value.trim());
  const precoTexto = document.getElementById('input-item-preco').value;
  const categoriaId = document.getElementById('input-item-categoria').value;
  const tipoMontagem = document.getElementById('input-item-tipo').value;
  const qtdSaboresTexto = document.getElementById('input-item-qtd-sabores').value;
  const precoTerceiroSaborTexto = document.getElementById('input-item-preco-terceiro-sabor').value;
  const imprimeEm = document.getElementById('input-item-imprime-em').value;
  const destaque = document.getElementById('input-item-destaque').checked;
  const disponivel = document.getElementById('input-item-disponivel').checked;

  const preco = parseFloat(precoTexto.replace(',', '.'));

  if (!nome || !preco || preco <= 0 || !categoriaId) {
    mostrarToast('Preenche nome, preço e categoria.', 'erro');
    return;
  }

  const precisaQtdSabores = tipoMontagem === 'monte_sabores' || tipoMontagem === 'escolha_um';
  const qtdSabores = precisaQtdSabores ? (parseInt(qtdSaboresTexto) || 1) : null;

  // O campo pede o preço TOTAL com 3 sabores — aqui calculamos sozinhos
  // a diferença em relação ao preço base, que é o que fica salvo de fato
  let precoTerceiroSabor = 0;
  if (tipoMontagem === 'monte_sabores' && precoTerceiroSaborTexto) {
    const totalTresSabores = parseFloat(precoTerceiroSaborTexto.replace(',', '.')) || 0;
    precoTerceiroSabor = Math.max(0, totalTresSabores - preco);
  }

  const dadosItem = {
    estabelecimento_id: estado.perfil.estabelecimento_id,
    categoria_id: categoriaId,
    nome,
    descricao: descricao || null,
    preco_base: preco,
    tipo_montagem: tipoMontagem,
    qtd_sabores_inclusos: qtdSabores,
    preco_terceiro_sabor: precoTerceiroSabor,
    imprime_em: imprimeEm,
    destaque,
    disponivel,
  };

  let erro, itemIdSalvo;
  if (estado.itemEmEdicaoId) {
    itemIdSalvo = estado.itemEmEdicaoId;
    ({ error: erro } = await supabaseClient.from('itens_cardapio').update(dadosItem).eq('id', itemIdSalvo));
  } else {
    const proximaOrdem = estado.itens.filter(i => i.categoria_id === categoriaId).length + 1;
    const { data, error: erroInsert } = await supabaseClient
      .from('itens_cardapio')
      .insert({ ...dadosItem, ordem_exibicao: proximaOrdem })
      .select()
      .single();
    erro = erroInsert;
    itemIdSalvo = data?.id;
  }

  if (erro) {
    mostrarToast('Erro ao salvar item.', 'erro');
    console.error(erro);
    return;
  }

  // Grava os vínculos de ingredientes (só se o tipo usa ingredientes)
  if (tipoMontagem !== 'venda_direta' && itemIdSalvo) {
    await salvarVinculosIngredientes(itemIdSalvo);
  }

  mostrarToast('Item salvo!');
  fecharModalItem();
  await carregarItens();
}

async function salvarVinculosIngredientes(itemId) {
  // Estratégia simples: apaga tudo e recria — evita ter que "diferenciar"
  // o que mudou, e a tabela item_ingredientes é pequena por item
  await supabaseClient.from('item_ingredientes').delete().eq('item_id', itemId);

  const linhas = Object.entries(estado.vinculosAtuais)
    .filter(([, v]) => v.selecionado)
    .map(([ingredienteId, v]) => ({
      item_id: itemId,
      ingrediente_id: ingredienteId,
      papel: v.papel,
      preco_acrescimo: v.papel === 'opcao' ? (v.precoAcrescimo || 0) : 0,
    }));

  if (linhas.length > 0) {
    const { error } = await supabaseClient.from('item_ingredientes').insert(linhas);
    if (error) console.error('Erro ao salvar vínculos de ingredientes:', error);
  }
}

async function excluirItem() {
  if (!estado.itemEmEdicaoId) return;
  const confirmar = confirm('Excluir esse item de vez? Isso não afeta pedidos já feitos no passado, só remove ele do cardápio pra novos pedidos.');
  if (!confirmar) return;

  const { error } = await supabaseClient.from('itens_cardapio').delete().eq('id', estado.itemEmEdicaoId);
  if (error) {
    mostrarToast('Erro ao excluir. Se já foi usado em algum pedido, desative em vez de excluir.', 'erro');
    return;
  }

  mostrarToast('Item excluído.');
  fecharModalItem();
  await carregarItens();
}

iniciar();
