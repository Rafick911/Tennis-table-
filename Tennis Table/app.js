const STORAGE_KEY = 'tablepro-platform-state-v2';
const ADMIN_EMAIL = 'admin@tablepro.com';
const ADMIN_PASSWORD = 'Admin123!';
const SUPABASE_URL = 'https://rlwuwddxgmonfujiyplx.supabase.co';
const SUPABASE_PUBLIC_KEY = 'sb_publishable_sHXJ579XsUypzQC_jdel-w_mrDzETA6';
const supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);
let sharedPublicationsReady = false;
let sharedPublicationRefreshTimer = null;

const starterState = {
  users: [{
    id: 'admin-1',
    name: 'Administrateur',
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    role: 'admin',
    referralCode: null,
    referredBy: null,
    balance: 0,
    transactions: [],
    referrals: [],
    vipStatus: 'inactive',
    vipExpiresAt: null,
    vipHistory: [],
    createdAt: new Date().toISOString(),
    isActive: true
  }],
  currentUserId: null,
  publications: [],
  predictions: [
    {
      id: 'pred-1', competition: 'Open de France', player1: 'Lucas Nöel', player2: 'Yanis Duhamel',
      date: '2026-10-07', time: '18:30', market: 'Vainqueur du match', prediction: 'Lucas Nöel',
      score: '3-1', confidence: 85,
      analysis: 'Le joueur local domine les échanges longs et possède un meilleur taux de réussite sur les retours.',
      stats: 'L5: 4V-1D | H2H: 7-5 | Points moyens: 11.8',
      access: 'free', price: 0, status: 'à venir', published: true, unlockedBy: [], createdAt: new Date().toISOString()
    },
    {
      id: 'pred-2', competition: 'World Tour', player1: 'Ronan Gauthier', player2: 'Milan Yacine',
      date: '2026-10-09', time: '20:00', market: 'Vainqueur du 1er set', prediction: 'Milan Yacine',
      score: '11-9', confidence: 76,
      analysis: 'Le premier set sera probablement serré, avec un avantage pour le joueur qui gagne la première ligne de service.',
      stats: 'Premier set : 58% de victoires pour le serveur | Séries récentes : 5V',
      access: 'vip', price: 500, status: 'à venir', published: true, unlockedBy: [], createdAt: new Date().toISOString()
    },
    {
      id: 'pred-3', competition: 'Coupe d’Europe', player1: 'Theo Lemaire', player2: 'Eliot Bousset',
      date: '2026-10-05', time: '19:15', market: 'Score exact', prediction: 'Theo Lemaire',
      score: '3-2', confidence: 81,
      analysis: 'Le match sera long et intense avec des échanges du fond de table très équilibrés.',
      stats: 'Matchs en 4 sets ou plus: 4 | Moyenne points: 12.1',
      access: 'free', price: 0, status: 'gagné', published: true, unlockedBy: [], createdAt: new Date().toISOString()
    }
  ],
  rechargeCodes: [],
  rechargePacks: [2000, 7000, 30000],
  vipActivations: [],
  adminLogs: [],
  visits: [],
  payments: []
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('tablepro-platform-state-v1');
    const parsed = JSON.parse(raw || 'null');
    if (!parsed) return structuredClone(starterState);
    const merged = { ...structuredClone(starterState), ...parsed, currentUserId: sessionStorage.getItem('tablepro-current-user') };
    const migratedUsers = [];
    merged.users = (parsed.users || starterState.users).map((user) => {
      const migrated = {
        balance: 0, transactions: [], referrals: [], referredBy: null, unlockedPublications: [],
        vipStatus: 'inactive', vipExpiresAt: null, vipHistory: [],
        isActive: true, ...user
      };
        migrated.preferences = { appearance: 'dark', ...(user.preferences || {}) };
        migrated.unlockedPublications = user.unlockedPublications || [];
        migrated.allocation = {
          startingCapital: 0,
          maxRisk: 0,
          riskPercent: 2,
          coupons: [],
          ...(user.allocation || {})
        };
      if (migrated.role !== 'admin' && (!migrated.referralCode || migratedUsers.some((existing) => existing.referralCode === migrated.referralCode))) {
        migrated.referralCode = createReferralCode(migratedUsers);
      }
      migratedUsers.push(migrated);
      return migrated;
    });
    merged.predictions = (parsed.predictions || starterState.predictions).map((prediction) => {
      const finalized = isFinalResult(prediction);
      const resultHistory = Array.isArray(prediction.resultHistory) ? prediction.resultHistory : [];
      if (finalized && !resultHistory.length) {
        resultHistory.push({
          status: prediction.status,
          resultPublished: true,
          changedAt: prediction.resultPublishedAt || prediction.createdAt,
          changedBy: null,
          imported: true
        });
      }
      return {
        price: prediction.access === 'vip' ? 500 : 0, unlockedBy: [], ...prediction,
        publicationId: prediction.publicationId || `legacy-${prediction.id}`,
        status: finalized ? prediction.status : 'à venir',
        resultPublished: finalized,
        resultPublishedAt: finalized ? prediction.resultPublishedAt || prediction.createdAt : null,
        resultHistory
      };
    });
    merged.publications = parsed.publications || [];
    merged.publications.forEach((publication) => {
      publication.everPublished ??= Boolean(publication.published);
      publication.archived = Boolean(publication.archived);
    });
    const publicationMap = new Map(merged.publications.map((publication) => [publication.id, publication]));
    merged.predictions.forEach((prediction) => {
      if (!publicationMap.has(prediction.publicationId)) {
        const publication = {
          id: prediction.publicationId,
          type: prediction.access === 'vip' ? 'vip' : 'simple',
          title: `${prediction.access === 'vip' ? 'VIP' : 'Simple'} — ${prediction.competition}`,
          price: prediction.price,
          predictionIds: [],
          published: prediction.published,
          unlockedBy: [],
          createdAt: prediction.createdAt
        };
        publicationMap.set(publication.id, publication);
        merged.publications.push(publication);
      }
      const publication = publicationMap.get(prediction.publicationId);
      publication.predictionIds ||= [];
      if (!publication.predictionIds.includes(prediction.id)) publication.predictionIds.push(prediction.id);
      prediction.price = publication.type === 'vip' ? Number(publication.price || prediction.price || 500) : 0;
    });
    merged.visits = parsed.visits || [];
    merged.payments = parsed.payments || [];
    merged.rechargeCodes = parsed.rechargeCodes || [];
    merged.rechargePacks = parsed.rechargePacks || [2000, 7000, 30000];
    merged.vipActivations = parsed.vipActivations || [];
    merged.adminLogs = parsed.adminLogs || [];
    return merged;
  } catch (error) {
    console.error('Impossible de lire les données locales TablePro.', error);
    return structuredClone(starterState);
  }
}

const state = loadState();

function saveState() {
  const persisted = { ...state, currentUserId: null };
  if (supabaseClient) {
    persisted.predictions = state.predictions.map((prediction) => prediction.access === 'vip'
      ? { ...prediction, prediction: '', odds: '', confidence: 0 }
      : prediction);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

async function refreshSharedPublications() {
  if (!supabaseClient) {
    throw new Error('Le client Supabase n’a pas pu être chargé.');
  }
  const [publicationResult, matchResult, pickResult] = await Promise.all([
    supabaseClient.from('tablepro_publications')
      .select('id,title,type,price,published,ever_published,archived,created_at')
      .order('created_at', { ascending: false }),
    supabaseClient.from('tablepro_matches')
      .select('id,publication_id,competition,player1,player2,match_date,match_time,market,status'),
    supabaseClient.from('tablepro_match_picks')
      .select('match_id,prediction,odds,confidence')
  ]);
  const error = publicationResult.error || matchResult.error || pickResult.error;
  if (error) throw error;

  const publicationRows = publicationResult.data || [];
  const publicationMap = new Map(publicationRows.map((publication) => [publication.id, publication]));
  const picks = new Map((pickResult.data || []).map((pick) => [pick.match_id, pick]));
  const matchRows = matchResult.data || [];

  state.publications = publicationRows.map((publication) => ({
    id: publication.id,
    title: publication.title,
    type: publication.type,
    price: Number(publication.price) || 0,
    published: publication.published,
    archived: publication.archived,
    everPublished: publication.ever_published,
    createdAt: publication.created_at,
    predictionIds: matchRows
      .filter((match) => match.publication_id === publication.id)
      .map((match) => match.id),
    unlockedBy: []
  }));
  state.predictions = matchRows.map((match) => {
    const publication = publicationMap.get(match.publication_id);
    const pick = picks.get(match.id);
    return {
      id: match.id,
      publicationId: match.publication_id,
      competition: match.competition,
      player1: match.player1,
      player2: match.player2,
      date: match.match_date,
      time: match.match_time,
      market: match.market,
      prediction: pick?.prediction || '',
      odds: pick?.odds || '',
      confidence: Number(pick?.confidence) || 0,
      access: publication?.type === 'vip' ? 'vip' : 'free',
      price: Number(publication?.price) || 0,
      status: match.status,
      published: Boolean(publication?.published),
      resultPublished: isFinalResult({ status: match.status }),
      createdAt: publication?.created_at || new Date().toISOString()
    };
  });
  sharedPublicationsReady = true;
  saveState();
  renderAll();
}

function reportSharedPublicationError(action, error) {
  console.error(`${action} Supabase a échoué.`, error);
  toast(`${action} impossible : ${error.message || 'vérifiez la configuration Supabase.'}`);
}

async function initializeSharedPublications() {
  if (!supabaseClient) {
    reportSharedPublicationError('Initialisation', new Error('Le SDK Supabase ne s’est pas chargé.'));
    return;
  }
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    const session = data.session;
    if (session) {
      const { data: isRemoteAdmin, error: roleError } = await supabaseClient.rpc('tablepro_is_admin');
      if (roleError) {
        await supabaseClient.auth.signOut();
        if (currentUser()?.role === 'admin') {
          state.currentUserId = null;
          sessionStorage.removeItem('tablepro-current-user');
          renderAll();
        }
        throw roleError;
      }
      if (isRemoteAdmin !== true || currentUser()?.role !== 'admin') {
        await supabaseClient.auth.signOut();
        if (currentUser()?.role === 'admin') {
          state.currentUserId = null;
          sessionStorage.removeItem('tablepro-current-user');
          renderAll();
        }
      }
    } else if (currentUser()?.role === 'admin') {
      state.currentUserId = null;
      sessionStorage.removeItem('tablepro-current-user');
      renderAll();
      toast('Reconnecte-toi avec ton compte administrateur Supabase.');
    }

    await refreshSharedPublications();
    if (!sharedPublicationRefreshTimer) {
      sharedPublicationRefreshTimer = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        refreshSharedPublications().catch((error) => {
          console.error('Actualisation automatique des publications échouée.', error);
        });
      }, 30000);
      window.addEventListener('focus', () => {
        refreshSharedPublications().catch((error) => {
          reportSharedPublicationError('Actualisation des publications', error);
        });
      });
    }
  } catch (error) {
    reportSharedPublicationError('Chargement des publications', error);
  }
}

function createReferralCode(users = state.users || []) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    code = `TP-${Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('')}`;
  } while (users.some((user) => user.referralCode === code));
  return code;
}

function generateNumericCode(existingCodes) {
  let code;
  do {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    code = Array.from(bytes, (value) => String(value % 10)).join('');
  } while (existingCodes.includes(code));
  return code;
}

const byId = (id) => document.getElementById(id);
const currentUser = () => state.users.find((user) => user.id === state.currentUserId) || null;
const isAdmin = () => currentUser()?.role === 'admin';
const money = (amount) => `${Number(amount || 0).toLocaleString('fr-FR')} FCFA`;
function isFinalResult(prediction) {
  return prediction.status === 'gagné' || prediction.status === 'perdu';
}

function predictionDate(prediction) {
  const timestamp = Date.parse(`${prediction.date || ''}T${prediction.time || '00:00'}`);
  return Number.isNaN(timestamp) ? Date.parse(prediction.createdAt) || 0 : timestamp;
}

function toast(message) {
  const element = byId('toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('visible'), 2600);
}

function switchEntryTab(tab) {
  document.querySelectorAll('[data-entry-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.entryTab === tab);
  });
  byId('entry-signup-form').classList.toggle('active', tab === 'signup');
  byId('entry-login-form').classList.toggle('active', tab === 'login');
}

function showApplication() {
  const signedIn = Boolean(currentUser() && currentUser().isActive);
  if (!signedIn && state.currentUserId) {
    state.currentUserId = null;
    sessionStorage.removeItem('tablepro-current-user');
  }
  byId('entry-gate').classList.toggle('hidden', signedIn);
  document.querySelector('.page-shell').classList.toggle('hidden', !signedIn);
  document.querySelectorAll('.requires-auth').forEach((element) => element.classList.toggle('hidden', !signedIn));
  byId('admin-panel').classList.toggle('hidden', !isAdmin());
  document.querySelectorAll('[data-admin-only]').forEach((element) => element.classList.toggle('hidden', !isAdmin()));
  if (signedIn) {
    showSection(location.hash.slice(1) || 'home');
  }
}

function showSection(sectionId) {
  const main = document.querySelector('main');
  const sections = [...main.children].filter((element) => element.tagName === 'SECTION');
  const validSection = sections.find((section) => section.id === sectionId && !section.classList.contains('hidden'));
  const targetId = validSection ? sectionId : 'home';
  sections.forEach((section) => {
    const show = section.id === targetId || (targetId === 'home' && section.id === 'home-announcement');
    section.classList.toggle('app-view-hidden', !show);
  });
  main.scrollTop = 0;
  const navigationLinks = document.querySelectorAll('.drawer-nav a[href^="#"]');
  navigationLinks.forEach((link) => {
    const active = link.getAttribute('href') === `#${targetId}`;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const activeLink = [...navigationLinks].find((link) => link.getAttribute('href') === `#${targetId}`);
  byId('current-page-title').textContent = activeLink?.querySelector('span')?.textContent.trim() || 'Accueil';
  if (targetId !== sectionId) {
    history.replaceState(null, '', `#${targetId}`);
  }
}

function secureText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function updateExpiredVip() {
  const now = Date.now();
  state.users.forEach((user) => {
    if (user.vipStatus === 'active' && user.vipExpiresAt && Date.parse(user.vipExpiresAt) <= now) {
      user.vipStatus = 'expired';
    }
  });
}

function renderPredictions() {
  const container = byId('prediction-list');
  const activePredictions = state.predictions.filter((prediction) =>
    prediction.published && prediction.access === 'free' && !isFinalResult(prediction)
  );
  container.innerHTML = activePredictions.map((prediction) => {
    return `
      <article class="match-card">
        <div class="card-head">
          <span class="competition">${secureText(prediction.competition)}</span>
          <span class="badge gratuit">Simple</span>
        </div>
        <div class="match-team-row">
          <div class="player-box"><strong>${secureText(prediction.player1)}</strong><span>Joueur 1</span></div>
          <div class="vs-pill">VS</div>
          <div class="player-box"><strong>${secureText(prediction.player2)}</strong><span>Joueur 2</span></div>
        </div>
        <ul class="meta-list">
          <li><span>Date / Heure</span><strong>${secureText(prediction.date)} • ${secureText(prediction.time)}</strong></li>
          <li><span>Marché</span><strong>${secureText(prediction.market)}</strong></li>
          <li><span>Statut</span><strong>EN ATTENTE</strong></li>
          <li><span>H2H</span><strong>7 - 5</strong></li>
          <li><span>Forme</span><strong>${secureText((prediction.stats || '—').split('|')[0])}</strong></li>
        </ul>
        <div class="prediction-summary">
          <div class="label"><span>Pronostic</span><span>🔥 PRONOSTIC PRINCIPAL</span></div>
          <strong>${secureText(prediction.prediction)}</strong>
          <div class="label" style="margin-top: 8px;"><span>Odds</span><span>⭐ Confiance : ${Number(prediction.confidence)}%</span></div>
          <strong>${secureText(prediction.odds || '—')}</strong>
        </div>
      </article>
    `;
  }).join('');
  renderPublications();
}

function matchCardMarkup(prediction, locked = false) {
  if (locked) {
    return `<article class="match-card vip-locked"><div class="card-head"><span class="competition">Match VIP</span><span class="badge vip">Verrouillé</span></div><div class="locked-match-content"><span>🔒</span><strong>Contenu premium masqué</strong><span>Débloquez cette publication pour consulter le match et le pronostic.</span></div></article>`;
  }
  return `
    <article class="match-card">
      <div class="card-head"><span class="competition">${secureText(prediction.competition)}</span><span class="badge gratuit">Simple</span></div>
      <div class="match-team-row">
        <div class="player-box"><strong>${secureText(prediction.player1)}</strong><span>Joueur 1</span></div><div class="vs-pill">VS</div>
        <div class="player-box"><strong>${secureText(prediction.player2)}</strong><span>Joueur 2</span></div>
      </div>
      <ul class="meta-list">
        <li><span>Date / Heure</span><strong>${secureText(prediction.date)} • ${secureText(prediction.time)}</strong></li>
        <li><span>Odds</span><strong>${secureText(prediction.odds || '—')}</strong></li>
        <li><span>Confiance</span><strong>${Number(prediction.confidence)}%</strong></li>
        <li><span>Résultat</span><strong>${isFinalResult(prediction) ? prediction.status.toUpperCase() : 'EN ATTENTE'}</strong></li>
      </ul>
      <div class="prediction-summary"><div class="label"><span>Prédiction</span><span>Pronostic manuel</span></div><strong>${secureText(prediction.prediction)}</strong></div>
    </article>`;
}

function renderPublications() {
  const simpleContainer = byId('simple-publications');
  const vipContainer = byId('vip-publications');
  if (!simpleContainer || !vipContainer) return;
  const pubs = state.publications.filter((publication) => publication.published && !publication.archived);
  const activeMatches = (publication) => publication.predictionIds
    .map((id) => state.predictions.find((prediction) => prediction.id === id))
    .filter((prediction) => prediction && prediction.published && !isFinalResult(prediction));
  simpleContainer.innerHTML = pubs.filter((publication) => publication.type === 'simple').map((publication) => {
    const matches = activeMatches(publication);
    if (!matches.length) return '';
    return `<article class="published-bundle"><header><div><span class="plan-tag">SIMPLE</span><h3>${secureText(publication.title)}</h3></div><span class="bundle-meta">${matches.length} matchs • ${new Date(publication.createdAt).toLocaleDateString('fr-FR')}</span></header><div class="prediction-grid">${matches.map((prediction) => matchCardMarkup(prediction)).join('')}</div></article>`;
  }).join('') || '<p class="empty-state">Aucune publication simple pour le moment.</p>';
  vipContainer.innerHTML = pubs.filter((publication) => publication.type === 'vip').map((publication) => {
    const unlocked = isAdmin() || (!supabaseClient && currentUser()?.unlockedPublications?.includes(publication.id)) || false;
    const matches = activeMatches(publication);
    if (!matches.length) return '';
    const unlockAction = supabaseClient
      ? '<span class="status-badge neutral">Accès VIP verrouillé</span>'
      : `<button type="button" class="btn btn-primary unlock-publication" data-publication-id="${secureText(publication.id)}">Débloquer le VIP</button>`;
    return `<article class="published-bundle vip-bundle ${unlocked ? 'unlocked' : 'locked'}"><header><div><span class="plan-tag">VIP • ${matches.length} matchs</span><h3>${secureText(publication.title)}</h3><span class="bundle-meta">${new Date(publication.createdAt).toLocaleDateString('fr-FR')}</span></div><div class="bundle-buy"><strong>${money(publication.price)}</strong>${unlocked ? '<span class="status-badge success">Débloqué</span>' : unlockAction}</div></header><div class="prediction-grid">${matches.map((prediction) => matchCardMarkup(prediction, !unlocked)).join('')}</div>${!unlocked ? `<p class="locked-caption">Les ${matches.length} matchs, prédictions, odds et confiances seront visibles après déblocage.</p>` : ''}</article>`;
  }).join('') || '<p class="empty-state">Aucune publication VIP pour le moment.</p>';
}

function updatePublicationBuilder() {
  const type = byId('publication-type').value;
  const forms = [...byId('publication-match-forms').querySelectorAll('.builder-match')];
  byId('publication-price-field').classList.toggle('hidden', type !== 'vip');
  byId('publication-match-count').textContent = `${forms.length} match${forms.length === 1 ? '' : 's'} — ${type === 'simple' ? '2 requis' : '5 minimum'}`;
  byId('publication-preview').innerHTML = `<h4>Aperçu du coupon</h4><div class="preview-match-list">${forms.map((form, index) => {
    const value = (name) => secureText(form.querySelector(`[name="${name}"]`)?.value || 'À renseigner');
    return `<div class="preview-match"><strong>Match ${index + 1}</strong><span>${value('player1')} vs ${value('player2')}</span><span>${value('competition')} · ${value('date')} ${value('time')}</span><span>${value('prediction')} · Odds ${value('odds')} · ${value('confidence')}%</span></div>`;
  }).join('')}</div>`;
}

function addBuilderMatch() {
  const container = byId('publication-match-forms');
  const index = container.querySelectorAll('.builder-match').length + 1;
  const template = byId('publication-match-template');
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.builder-match');
  card.querySelector('.builder-match-title').textContent = `Match ${index}`;
  card.dataset.index = String(index);
  container.append(fragment);
  updatePublicationBuilder();
}

function renderMember() {
  const user = currentUser();
  if (!user) return;
  const activeVip = user.vipStatus === 'active' && Date.parse(user.vipExpiresAt) > Date.now();
  byId('member-name').textContent = user.name;
  byId('account-status').textContent = user.role === 'admin' ? 'Administrateur' : 'Membre actif';
  byId('vip-badge').textContent = activeVip ? 'VIP actif' : 'Compte standard';
  byId('vip-badge').className = `status-badge ${activeVip ? 'success' : 'neutral'}`;
  byId('vip-status').textContent = activeVip ? 'VIP actif' : user.vipStatus === 'expired' ? 'VIP expiré' : 'Inactif';
  byId('vip-expiration').textContent = user.vipExpiresAt ? new Date(user.vipExpiresAt).toLocaleString('fr-FR') : '—';
  byId('vip-history').textContent = String(user.vipHistory?.length || 0);
  byId('member-referral-code').textContent = user.referralCode;
  byId('referral-share-code').value = user.referralCode;
  byId('account-balance').textContent = money(user.balance);
  byId('referral-summary').textContent = `Récompenses validées : ${user.referrals.length} • Solde : ${money(user.referrals.length * 50)}`;
  byId('transaction-history').innerHTML = renderTransactionRows(user.transactions);
  byId('referral-history').innerHTML = user.referrals.length
    ? user.referrals.map((referral) => `<div class="transaction-row"><strong>+50 FCFA</strong><span>Parrainage de ${secureText(referral.name)}</span><time>${new Date(referral.createdAt).toLocaleDateString('fr-FR')}</time></div>`).join('')
    : '<p class="helper-text">Aucune récompense d’affiliation pour le moment.</p>';
}

function renderTransactionRows(transactions) {
  if (!transactions?.length) return '<p class="helper-text">Aucune opération pour le moment.</p>';
  return [...transactions].reverse().slice(0, 8).map((transaction) => `
    <div class="transaction-row">
      <strong class="${transaction.amount >= 0 ? 'positive' : 'negative'}">${transaction.amount > 0 ? '+' : ''}${money(transaction.amount)}</strong>
      <span>${secureText(transaction.label)}</span>
      <time>${new Date(transaction.createdAt).toLocaleDateString('fr-FR')}</time>
    </div>
  `).join('');
}

function renderResults() {
  const predictions = state.predictions.filter((prediction) => {
    const publication = state.publications.find((item) => item.id === prediction.publicationId);
    const vipUnlocked = publication?.type !== 'vip' || isAdmin() ||
      (!supabaseClient && currentUser()?.unlockedPublications?.includes(publication.id));
    return (publication?.everPublished || publication?.published) && vipUnlocked && isFinalResult(prediction);
  }).sort((a, b) => predictionDate(b) - predictionDate(a));
  const won = predictions.filter((prediction) => prediction.status === 'gagné').length;
  const lost = predictions.filter((prediction) => prediction.status === 'perdu').length;
  const completed = won + lost;
  const stats = [
    ['Taux de réussite', `${completed ? Math.round(won / completed * 100) : 0}%`],
    ['Pronostics gagnants', String(won)],
    ['Pronostics perdants', String(lost)],
    ['Résultats publiés', String(predictions.length)]
  ];
  byId('results-summary').innerHTML = stats.map(([label, value]) =>
    `<div class="stat-card"><span>${label}</span><strong>${value}</strong></div>`).join('');
  byId('results-list').innerHTML = predictions.map((prediction) => {
    const publication = state.publications.find((item) => item.id === prediction.publicationId);
    const allMatches = publication.predictionIds
      .map((id) => state.predictions.find((prediction) => prediction.id === id))
      .filter(Boolean);
    const publicationComplete = allMatches.length > 0 && allMatches.every(isFinalResult);
    const statusClass = prediction.status === 'gagné' ? 'success' : 'danger';
    return `<article class="result-item"><div class="result-core"><div class="result-score">${secureText(prediction.player1)}<br />vs<br />${secureText(prediction.player2)}</div><div><span class="plan-tag">${publication.type === 'vip' ? 'VIP' : 'SIMPLE'}</span><strong>${secureText(prediction.competition)}</strong><div class="result-meta">${secureText(publication.title)} • ${allMatches.filter(isFinalResult).length}/${allMatches.length} résultats${publicationComplete ? ' • Publication terminée' : ''}<br />${secureText(prediction.date)} • ${secureText(prediction.time)}</div></div></div><div class="result-details"><span><b>Prédiction</b> ${secureText(prediction.prediction)}</span><span><b>Odds</b> ${secureText(prediction.odds || '—')}</span><span class="status-badge ${statusClass}">${prediction.status === 'gagné' ? 'GAGNÉ' : 'PERDU'}</span></div></article>`;
  }).join('') || '<p class="empty-state">Aucun résultat publié pour le moment.</p>';
}

function renderRechargePacks() {
  byId('recharge-packs').innerHTML = state.rechargePacks.slice().sort((a, b) => a - b).map((amount) =>
    `<button type="button" class="pack-card" data-pack-amount="${amount}"><strong>${money(amount)}</strong><span>Pack recharge</span></button>`).join('');
  byId('recharge-pack-select').innerHTML = state.rechargePacks.slice().sort((a, b) => a - b).map((amount) =>
    `<option value="${amount}">${money(amount)}</option>`).join('');
}

function renderAdmin() {
  const members = state.users.filter((user) => user.role !== 'admin');
  const codesUsed = state.rechargeCodes.filter((code) => code.status === 'used').length;
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const newMembers = members.filter((user) => Date.parse(user.createdAt) >= thirtyDaysAgo).length;
  const rechargePayments = state.payments.filter((payment) => payment.type === 'recharge');
  const vipPayments = state.payments.filter((payment) => payment.type === 'vip');
  byId('total-members').textContent = String(members.length);
  byId('active-members-count').textContent = String(members.filter((user) => user.isActive).length);
  byId('active-vip').textContent = String(members.filter((user) => user.vipStatus === 'active').length);
  byId('expired-vip').textContent = String(members.filter((user) => user.vipStatus === 'expired').length);
  byId('generated-codes').textContent = String(state.rechargeCodes.length);
  byId('used-codes').textContent = String(codesUsed);
  byId('available-codes').textContent = String(state.rechargeCodes.length - codesUsed);
  byId('published-predictions').textContent = String(state.predictions.filter((prediction) => prediction.published).length);
  byId('wins-losses').textContent = `${state.predictions.filter((prediction) => prediction.status === 'gagné').length} / ${state.predictions.filter((prediction) => prediction.status === 'perdu').length}`;
  byId('new-members-count').textContent = String(newMembers);
  byId('visit-count').textContent = String(state.visits.length);
  byId('payment-count').textContent = String(rechargePayments.length);
  byId('payment-total').textContent = money(rechargePayments.reduce((total, payment) => total + payment.amount, 0));
  byId('vip-revenue').textContent = `${vipPayments.length} / ${money(vipPayments.reduce((total, payment) => total + payment.amount, 0))}`;
  byId('recharge-codes-table-body').innerHTML = state.rechargeCodes.map((code) => {
    const user = state.users.find((candidate) => candidate.id === code.usedBy);
    return `<tr><td>${code.code}</td><td>${money(code.amount)}</td><td>${code.status === 'used' ? 'UTILISÉ' : 'DISPONIBLE'}</td><td>${new Date(code.createdAt).toLocaleString('fr-FR')}</td><td>${user ? secureText(user.name) : '—'}</td><td>${code.status === 'available' ? `<button class="table-action" data-remove-recharge="${secureText(code.id)}">Supprimer</button>` : '—'}</td></tr>`;
  }).join('');
  byId('admin-packs-list').innerHTML = state.rechargePacks.slice().sort((a, b) => a - b).map((amount) =>
    `<span class="admin-pack">${money(amount)} <button type="button" aria-label="Supprimer le pack ${amount}" data-remove-pack="${amount}">×</button></span>`).join('');
  byId('admin-users-table-body').innerHTML = members.map((user) =>
    `<tr><td>${secureText(user.name)}</td><td>${secureText(user.email)}</td><td>${secureText(user.referralCode)}</td><td>${user.referrals.length}</td><td>${money(user.balance)}</td><td>${user.isActive ? 'Actif' : 'Désactivé'}</td><td><button class="table-action" data-toggle-user="${secureText(user.id)}">${user.isActive ? 'Désactiver' : 'Réactiver'}</button></td></tr>`).join('');
  byId('balance-user-select').innerHTML = members.map((user) =>
    `<option value="${secureText(user.id)}">${secureText(user.name)} (${secureText(user.email)})</option>`).join('');
  byId('admin-predictions-table-body').innerHTML = state.publications.map((publication) => {
    const matches = publication.predictionIds.map((id) => state.predictions.find((prediction) => prediction.id === id)).filter(Boolean);
    return matches.map((prediction, index) =>
      `<tr><td>${secureText(publication.title)}<br>${index + 1}. ${secureText(prediction.player1)} vs ${secureText(prediction.player2)}</td><td>${publication.type === 'vip' ? `<input class="table-price" type="number" min="1" step="50" value="${publication.price}" data-edit-price="${secureText(publication.id)}" />` : 'Simple'}</td><td><select data-edit-status="${secureText(prediction.id)}"><option value="à venir" ${!isFinalResult(prediction) ? 'selected' : ''}>En attente</option><option value="gagné" ${prediction.status === 'gagné' ? 'selected' : ''}>Gagné</option><option value="perdu" ${prediction.status === 'perdu' ? 'selected' : ''}>Perdu</option></select></td><td>${publication.archived ? 'Archivée' : publication.published ? 'Publié' : 'Brouillon'}</td><td><button class="table-action" data-save-result="${secureText(prediction.id)}">Enregistrer résultat</button>${index === 0 ? ` <button class="table-action" data-save-publication="${secureText(publication.id)}">Enregistrer prix</button> ${publication.archived ? '' : `<button class="table-action" data-toggle-publication="${secureText(publication.id)}">${publication.published ? 'Dépublier' : 'Publier'}</button> <button class="table-action" data-delete-publication="${secureText(publication.id)}">Archiver</button>`}` : ''}</td></tr>`
    ).join('');
  }).join('');
  renderAdminActivityChart();
}

function renderAdminActivityChart() {
  const svg = byId('admin-activity-chart');
  if (!svg) return;
  const buckets = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - (6 - index));
    const key = day.toISOString().slice(0, 10);
    return {
      label: day.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      visits: state.visits.filter((visit) => visit.date.startsWith(key)).length,
      payments: state.payments.filter((payment) => payment.createdAt.startsWith(key)).length
    };
  });
  const max = Math.max(1, ...buckets.flatMap((bucket) => [bucket.visits, bucket.payments]));
  const bars = buckets.map((bucket, index) => {
    const x = 58 + index * 102;
    const visitHeight = bucket.visits / max * 136;
    const paymentHeight = bucket.payments / max * 136;
    return `<rect x="${x}" y="${170 - visitHeight}" width="24" height="${visitHeight}" rx="5" fill="#34d8c9"/><rect x="${x + 29}" y="${170 - paymentHeight}" width="24" height="${paymentHeight}" rx="5" fill="#6a79ff"/><text x="${x + 24}" y="198" class="chart-label">${bucket.label}</text>`;
  }).join('');
  svg.innerHTML = `<line x1="40" y1="170" x2="770" y2="170" class="chart-axis"/>${bars}<text x="52" y="20" class="chart-label">Visites</text><rect x="100" y="10" width="10" height="10" fill="#34d8c9"/><text x="122" y="20" class="chart-label">Paiements</text><rect x="180" y="10" width="10" height="10" fill="#6a79ff"/>`;
}

function getAllocation(user = currentUser()) {
  return user.allocation || (user.allocation = { startingCapital: 0, maxRisk: 0, riskPercent: 2, coupons: [] });
}

function getCouponLedger(user = currentUser()) {
  const allocation = getAllocation(user);
  let capital = Math.max(0, Number(allocation.startingCapital) || 0);
  const entries = [...(allocation.coupons || [])].sort((a, b) =>
    a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  return entries.map((coupon) => {
    capital = Math.max(0, capital + Number(coupon.netResult || 0));
    return { ...coupon, capitalAfter: capital };
  });
}

function recommendedStake(percent, capital, allocation) {
  let amount = capital * percent / 100;
  if (Number(allocation.maxRisk) > 0) amount = Math.min(amount, Number(allocation.maxRisk));
  return Math.max(0, Math.min(capital, Math.floor(amount / 50) * 50));
}

function renderCalculator() {
  const user = currentUser();
  const allocation = getAllocation(user);
  const ledger = getCouponLedger(user);
  const currentCapital = ledger.length ? ledger[ledger.length - 1].capitalAfter : Number(allocation.startingCapital) || 0;
  const odds = Number(byId('calculator-odds').value);
  const levels = [
    { label: 'Risque faible', percent: 1, color: 'low' },
    { label: 'Risque moyen', percent: Math.max(1, Math.min(10, Number(allocation.riskPercent) || 2)), color: 'medium' },
    { label: 'Risque élevé', percent: 10, color: 'high' }
  ];
  byId('calculator-results').innerHTML = levels.map((level) => {
    const stake = recommendedStake(level.percent, currentCapital, allocation);
    const payout = Number.isFinite(odds) && odds > 1 ? stake * odds : 0;
    const profit = Number.isFinite(odds) && odds > 1 ? stake * (odds - 1) : 0;
    return `<article class="risk-result ${level.color}"><div class="risk-title"><strong>${level.label}</strong><span>${level.percent}% cible</span></div><dl><div><dt>Mise conseillée</dt><dd>${money(stake)}</dd></div><div><dt>Gain potentiel total</dt><dd>${money(payout)}</dd></div><div><dt>Bénéfice potentiel</dt><dd>${money(profit)}</dd></div><div><dt>Capital après mise</dt><dd>${money(currentCapital - stake)}</dd></div><div><dt>Perte potentielle</dt><dd>−${money(stake)}</dd></div></dl></article>`;
  }).join('');
}

function renderAllocations() {
  const user = currentUser();
  if (!user) return;
  const allocation = getAllocation(user);
  const ledger = getCouponLedger(user);
  const initial = Math.max(0, Number(allocation.startingCapital) || 0);
  const current = ledger.length ? ledger[ledger.length - 1].capitalAfter : initial;
  const net = current - initial;
  const wins = ledger.filter((coupon) => coupon.result === 'won');
  const losses = ledger.filter((coupon) => coupon.result === 'lost');
  const winRate = ledger.length ? Math.round(wins.length / ledger.length * 100) : 0;
  const biggestWin = Math.max(0, ...ledger.map((coupon) => Number(coupon.netResult) || 0));
  const biggestLoss = Math.min(0, ...ledger.map((coupon) => Number(coupon.netResult) || 0));
  const changePercent = initial ? net / initial * 100 : 0;
  const indicator = byId('capital-trend');
  indicator.className = `trend-badge ${net > 0 ? 'up' : net < 0 ? 'down' : 'stable'}`;
  indicator.textContent = net > 0 ? '🟢 En progression' : net < 0 ? '🔴 En baisse' : '🟠 Stable';
  byId('starting-capital').value = String(initial);
  byId('max-risk').value = allocation.maxRisk ? String(allocation.maxRisk) : '';
  byId('risk-percent').value = String(allocation.riskPercent || 2);

  const metrics = [
    ['Capital initial', money(initial)],
    ['Capital actuel', money(current)],
    ['Bénéfice / perte total', `${net > 0 ? '+' : ''}${money(net)}`],
    ['Coupons', String(ledger.length)],
    ['Paris gagnés / perdus', `${wins.length} / ${losses.length}`],
    ['Taux de réussite', `${winRate}%`],
    ['Plus grosse perte', biggestLoss ? `−${money(Math.abs(biggestLoss))}` : money(0)],
    ['Plus gros gain', money(biggestWin)],
    ['Évolution', `${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%`]
  ];
  byId('allocation-stats').innerHTML = metrics.map(([label, value]) =>
    `<article class="allocation-stat"><span>${label}</span><strong>${value}</strong></article>`).join('');

  byId('coupon-history').innerHTML = ledger.length ? [...ledger].reverse().map((coupon) => `
    <tr>
      <td>${secureText(coupon.date)}</td>
      <td>${secureText(coupon.name)}</td>
      <td>${Number(coupon.odds).toFixed(2)}</td>
      <td>${money(coupon.stake)}</td>
      <td><span class="status-badge ${coupon.result === 'won' ? 'success' : 'danger'}">${coupon.result === 'won' ? 'Gagné' : 'Perdu'}</span></td>
      <td class="${coupon.netResult >= 0 ? 'positive' : 'negative'}">${coupon.netResult > 0 ? '+' : ''}${money(coupon.netResult)}</td>
      <td>${money(coupon.capitalAfter)}</td>
      <td>${secureText(coupon.comment || '—')}</td>
    </tr>`).join('') : '<tr><td colspan="8">Aucun coupon enregistré.</td></tr>';

  renderCapitalChart(initial, ledger);
  renderCalculator();
}

function renderCapitalChart(initial, ledger) {
  const svg = byId('capital-chart');
  const values = [initial, ...ledger.map((coupon) => coupon.capitalAfter)];
  const width = 800;
  const height = 230;
  const padding = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = padding + index * (width - padding * 2) / Math.max(values.length - 1, 1);
    const y = height - padding - (value - min) / range * (height - padding * 2);
    return `${x},${y}`;
  });
  const isUp = values[values.length - 1] >= values[0];
  const color = isUp ? '#4ad49a' : '#ff5979';
  svg.innerHTML = `
    <defs><linearGradient id="capital-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".24"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" class="chart-axis"/>
    <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" class="chart-axis"/>
    <polygon points="${padding},${height - padding} ${points.join(' ')} ${width - padding},${height - padding}" fill="url(#capital-fill)"/>
    <polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    ${points.map((point) => { const [x, y] = point.split(','); return `<circle cx="${x}" cy="${y}" r="5" fill="${color}"/>`; }).join('')}
    <text x="${padding}" y="18" class="chart-label">${money(Math.max(...values))}</text>
    <text x="${padding}" y="${height - 4}" class="chart-label">${money(Math.min(...values))}</text>`;
}

function renderSettings() {
  const user = currentUser();
  if (!user) return;
  user.preferences ||= { appearance: 'dark' };
  const appearance = user.preferences.appearance === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = appearance;
  byId('appearance-choice').value = appearance;
}

async function hashPassword(password, salt = null) {
  if (!crypto.subtle) throw new Error('Le chiffrement sécurisé n’est pas disponible dans ce navigateur.');
  const saltBytes = salt ? Uint8Array.from(atob(salt), (character) => character.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: 150000, hash: 'SHA-256' }, key, 256);
  return {
    salt: btoa(String.fromCharCode(...saltBytes)),
    hash: Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, '0')).join('')
  };
}

async function verifyPassword(user, password) {
  if (user.passwordHash && user.passwordSalt) {
    const result = await hashPassword(password, user.passwordSalt);
    return result.hash === user.passwordHash;
  }
  return user.password === password;
}

function showApplicationAndRender() {
  showApplication();
  renderAll();
}

let passwordMigration = Promise.resolve();

async function migrateLegacyPasswords() {
  let migrated = false;
  for (const user of state.users) {
    if (user.password && !user.passwordHash) {
      const credentials = await hashPassword(user.password);
      user.passwordSalt = credentials.salt;
      user.passwordHash = credentials.hash;
      delete user.password;
      migrated = true;
    }
  }
  if (migrated) saveState();
}

function renderAll() {
  updateExpiredVip();
  showApplication();
  if (!currentUser()) return;
  renderMember();
  renderPredictions();
  renderResults();
  renderRechargePacks();
  renderAllocations();
  renderSettings();
  if (isAdmin()) renderAdmin();
  saveState();
}

function addTransaction(user, amount, label, details = {}) {
  user.transactions.push({ id: crypto.randomUUID(), amount, label, details, createdAt: new Date().toISOString() });
}

async function handleSignup(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const name = String(form.get('name') || '').trim();
  const email = String(form.get('email') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');
  const confirmation = String(form.get('confirmPassword') || '');
  const referralCode = String(form.get('referralCode') || '').trim().toUpperCase();
  if (password !== confirmation) return toast('Les mots de passe ne correspondent pas.');
  if (!form.get('acceptTerms')) return toast('Veuillez accepter les conditions.');
  if (state.users.some((user) => user.email.toLowerCase() === email)) return toast('Un compte avec cet identifiant existe déjà.');

  let referrer = null;
  if (referralCode) {
    referrer = state.users.find((user) => user.role !== 'admin' && user.referralCode?.toUpperCase() === referralCode);
    if (!referrer) return toast('Ce code d’affiliation est invalide.');
  }
  let credentials;
  try {
    credentials = await hashPassword(password);
  } catch (error) {
    console.error('Impossible de sécuriser le nouveau mot de passe.', error);
    return toast(error.message || 'Impossible de sécuriser ce mot de passe.');
  }
  const user = {
    id: crypto.randomUUID(), name, email, passwordSalt: credentials.salt, passwordHash: credentials.hash,
    role: 'member', referralCode: createReferralCode(),
    referredBy: referrer?.id || null, balance: 0, transactions: [], referrals: [],
    vipStatus: 'inactive', vipExpiresAt: null, vipHistory: [], unlockedPublications: [], allocation: { startingCapital: 0, maxRisk: 0, riskPercent: 2, coupons: [] },
    preferences: { appearance: 'dark' }, createdAt: new Date().toISOString(), isActive: true
  };
  delete user.password;
  state.users.push(user);
  if (referrer && referrer.id !== user.id) {
    referrer.balance += 50;
    referrer.referrals.push({ userId: user.id, name: user.name, createdAt: new Date().toISOString() });
    addTransaction(referrer, 50, `Récompense d’affiliation : ${user.name}`, { referredUserId: user.id });
  }
  state.currentUserId = user.id;
  sessionStorage.setItem('tablepro-current-user', user.id);
  state.adminLogs.push({ action: 'member_signup', userId: user.id, createdAt: new Date().toISOString() });
  saveState();
  formElement.reset();
  renderAll();
  toast(referrer ? 'Compte créé. Votre parrain a reçu 50 FCFA.' : 'Compte créé avec succès.');
  location.hash = '#home';
}

async function handleLogin(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const login = String(form.get('loginEmail') || '').trim().toLowerCase();
  const password = String(form.get('loginPassword') || '');
  const user = state.users.find((candidate) => candidate.email.toLowerCase() === login && candidate.isActive);
  if (login === ADMIN_EMAIL) {
    if (!supabaseClient) return toast('La connexion administrateur nécessite le client Supabase.');
    if (!user || user.role !== 'admin') return toast('Compte administrateur local introuvable.');
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({ email: login, password });
      if (error) return toast(`Connexion administrateur refusée : ${error.message}`);
      const { data: isAdmin, error: roleError } = await supabaseClient.rpc('tablepro_is_admin');
      if (roleError || isAdmin !== true) {
        await supabaseClient.auth.signOut();
        if (roleError) console.error('La vérification du rôle administrateur a échoué.', roleError);
        return toast('Ce compte Supabase n’est pas autorisé comme administrateur.');
      }
      state.currentUserId = user.id;
      sessionStorage.setItem('tablepro-current-user', user.id);
      saveState();
      formElement.reset();
      renderAll();
      try {
        await refreshSharedPublications();
      } catch (error) {
        reportSharedPublicationError('Chargement des publications', error);
      }
      toast('Connexion administrateur réussie.');
      location.hash = '#home';
      return;
    } catch (error) {
      console.error('La connexion administrateur a échoué.', error);
      return toast(error.message || 'Impossible de se connecter à Supabase.');
    }
  }
  let verified = false;
  try {
    await passwordMigration;
    if (user) verified = await verifyPassword(user, password);
  } catch (error) {
    console.error('Échec de la vérification du mot de passe.', error);
    return toast(error.message || 'Impossible de vérifier le mot de passe.');
  }
  if (!user || !verified) return toast('Identifiants incorrects ou compte désactivé.');
  state.currentUserId = user.id;
  sessionStorage.setItem('tablepro-current-user', user.id);
  saveState();
  formElement.reset();
  renderAll();
  toast('Connexion réussie.');
  location.hash = '#home';
}

async function handlePredictionSubmit(event) {
  event.preventDefault();
  if (!isAdmin()) return toast('Accès réservé à l’administrateur.');
  const formElement = event.currentTarget;
  const type = byId('publication-type').value;
  const matchForms = [...byId('publication-match-forms').querySelectorAll('.builder-match')];
  if (type === 'simple' && matchForms.length !== 2) return toast('Une publication simple doit contenir exactement 2 matchs.');
  if (type === 'vip' && matchForms.length < 5) return toast('Une publication VIP doit contenir au moins 5 matchs.');
  if (!formElement.reportValidity()) return;
  const price = Number(byId('publication-price').value);
  if (type === 'vip' && (!Number.isSafeInteger(price) || price <= 0)) return toast('Définissez un prix VIP valide.');
  const publicationId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const matches = matchForms.map((matchForm) => {
    const get = (name) => String(matchForm.querySelector(`[name="${name}"]`)?.value || '').trim();
    return {
      id: crypto.randomUUID(),
      competition: get('competition'),
      player1: get('player1'),
      player2: get('player2'),
      date: get('date'),
      time: get('time'),
      market: get('market') || 'Vainqueur du match',
      prediction: get('prediction'),
      odds: Number(get('odds')).toFixed(2),
      score: '',
      confidence: Number(get('confidence')),
      analysis: '',
      stats: '',
      access: type === 'vip' ? 'vip' : 'free',
      price: type === 'vip' ? price : 0,
      status: 'à venir',
      published: true,
      publicationId,
      unlockedBy: [],
      createdAt
    };
  });
  const publication = {
    id: publicationId,
    type,
    title: `${type === 'vip' ? 'VIP' : 'Simple'} — Publication #${String(state.publications.length + 1).padStart(3, '0')}`,
    price: type === 'vip' ? price : 0,
    predictionIds: matches.map((match) => match.id),
    published: true,
    unlockedBy: [],
    createdAt
  };
  if (!supabaseClient) return toast('Publication impossible : Supabase n’est pas disponible.');
  try {
    const { error } = await supabaseClient.rpc('tablepro_admin_publish_publication', {
      p_publication: {
        id: publication.id,
        title: publication.title,
        type: publication.type,
        price: publication.price,
        created_at: publication.createdAt
      },
      p_matches: matches.map((match) => ({
        id: match.id,
        competition: match.competition,
        player1: match.player1,
        player2: match.player2,
        date: match.date,
        time: match.time,
        market: match.market,
        prediction: match.prediction,
        odds: match.odds,
        confidence: match.confidence
      }))
    });
    if (error) {
      reportSharedPublicationError('Publication des matchs', error);
      return;
    }
  } catch (error) {
    reportSharedPublicationError('Publication des matchs', error);
    return;
  }
  state.predictions.unshift(...matches);
  state.publications.unshift(publication);
  state.adminLogs.push({ action: 'publication_created', publicationId, type, matchCount: matches.length, createdAt });
  byId('publication-match-forms').innerHTML = '';
  addBuilderMatch();
  if (type === 'simple') addBuilderMatch();
  byId('publication-preview').innerHTML = '';
  renderAll();
  toast(`${publication.title} publiée.`);
}

function unlockPrediction(publicationId) {
  const user = currentUser();
  const publication = state.publications.find((item) => item.id === publicationId);
  if (!user || !publication || publication.type !== 'vip' || !publication.published) return;
  user.unlockedPublications ||= [];
  if (user.unlockedPublications.includes(publication.id)) return toast('Cette publication VIP est déjà débloquée.');
  if (user.balance < publication.price) {
    toast('Solde insuffisant. Veuillez recharger votre compte.');
    location.hash = '#recharge';
    byId('recharge-code-input').focus();
    return;
  }
  user.balance -= publication.price;
  user.unlockedPublications.push(publication.id);
  publication.unlockedBy ||= [];
  publication.unlockedBy.push(user.id);
  const firstMatch = state.predictions.find((item) => item.id === publication.predictionIds[0]);
  addTransaction(user, -publication.price, `Déblocage VIP : ${publication.title}`, { publicationId: publication.id });
  state.payments.push({ id: crypto.randomUUID(), type: 'vip', amount: publication.price, userId: user.id, publicationId: publication.id, createdAt: new Date().toISOString() });
  state.adminLogs.push({ action: 'vip_publication_unlocked', userId: user.id, publicationId, createdAt: new Date().toISOString() });
  saveState();
  renderAll();
  toast(`Publication VIP débloquée${firstMatch ? ` : ${firstMatch.competition}` : ''}.`);
}

function generateRechargeCode() {
  if (!isAdmin()) return toast('Accès réservé à l’administrateur.');
  const amount = Math.floor(Number(byId('recharge-amount').value));
  const count = Math.floor(Number(byId('recharge-code-count').value));
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(count) || count < 1 || count > 100) return toast('Montant ou nombre de codes invalide (1 à 100).');
  const generated = [];
  for (let index = 0; index < count; index += 1) {
    const code = generateNumericCode(state.rechargeCodes.map((record) => record.code));
    generated.push({
      id: crypto.randomUUID(), code, amount, status: 'available',
      createdAt: new Date().toISOString(), usedAt: null, usedBy: null
    });
  }
  state.rechargeCodes.unshift(...generated);
  if (!state.rechargePacks.includes(amount)) state.rechargePacks.push(amount);
  saveState();
  renderAll();
  byId('generated-recharge-output').textContent = generated.map((entry) => entry.code).join(' · ');
  toast(`${count} code${count > 1 ? 's' : ''} généré${count > 1 ? 's' : ''} pour ${money(amount)}.`);
}

function redeemRechargeCode() {
  const user = currentUser();
  const input = byId('recharge-code-input').value.trim();
  const message = byId('recharge-message');
  if (!user) return toast('Connectez-vous pour recharger votre solde.');
  if (!/^\d{12}$/.test(input)) {
    message.textContent = 'Le code doit contenir exactement 12 chiffres.';
    return;
  }
  const record = state.rechargeCodes.find((code) => code.code === input);
  if (!record) {
    message.textContent = 'Code de recharge introuvable.';
    return;
  }
  if (record.status !== 'available') {
    message.textContent = 'Ce code a déjà été utilisé et ne peut pas être réutilisé.';
    return;
  }
  record.status = 'used';
  record.usedBy = user.id;
  record.usedAt = new Date().toISOString();
  user.balance += record.amount;
  addTransaction(user, record.amount, `Recharge du solde avec code`, { rechargeCodeId: record.id });
  state.payments.push({ id: crypto.randomUUID(), type: 'recharge', amount: record.amount, userId: user.id, codeId: record.id, createdAt: new Date().toISOString() });
  state.adminLogs.push({ action: 'recharge_code_redeemed', userId: user.id, codeId: record.id, createdAt: new Date().toISOString() });
  byId('recharge-code-input').value = '';
  message.textContent = `Solde crédité de ${money(record.amount)}.`;
  saveState();
  renderAll();
  toast(`Recharge réussie : +${money(record.amount)}.`);
}

function updatePack(event) {
  event.preventDefault();
  if (!isAdmin()) return toast('Accès réservé à l’administrateur.');
  const amount = Math.floor(Number(byId('new-pack-amount').value));
  if (!Number.isSafeInteger(amount) || amount <= 0) return toast('Montant de pack invalide.');
  if (!state.rechargePacks.includes(amount)) state.rechargePacks.push(amount);
  byId('new-pack-amount').value = '';
  saveState();
  renderAll();
  toast('Pack enregistré.');
}

function adjustMemberBalance(event) {
  event.preventDefault();
  if (!isAdmin()) return toast('Accès réservé à l’administrateur.');
  const target = state.users.find((user) => user.id === byId('balance-user-select').value);
  const amount = Math.floor(Number(byId('balance-adjustment').value));
  const direction = byId('balance-direction').value;
  if (!target || !Number.isSafeInteger(amount) || amount <= 0) return toast('Membre ou montant invalide.');
  if (direction === 'debit' && target.balance < amount) return toast('Solde insuffisant pour ce débit.');
  const value = direction === 'credit' ? amount : -amount;
  target.balance += value;
  addTransaction(target, value, `Ajustement administrateur : ${String(byId('balance-reason').value || 'ajustement').trim()}`);
  state.adminLogs.push({ action: 'balance_adjustment', targetUserId: target.id, amount: value, createdAt: new Date().toISOString() });
  byId('balance-adjustment-form').reset();
  renderAll();
  toast('Solde mis à jour.');
}

function saveCapitalSettings(event) {
  event.preventDefault();
  const allocation = getAllocation();
  const startingCapital = Number(byId('starting-capital').value);
  const maxRisk = Number(byId('max-risk').value || 0);
  const riskPercent = Number(byId('risk-percent').value);
  if (!Number.isSafeInteger(startingCapital) || startingCapital < 0 ||
      !Number.isFinite(maxRisk) || maxRisk < 0 ||
      !Number.isFinite(riskPercent) || riskPercent < 0 || riskPercent > 10) {
    return toast('Vérifiez les montants et le pourcentage de risque.');
  }
  allocation.startingCapital = startingCapital;
  allocation.maxRisk = maxRisk;
  allocation.riskPercent = riskPercent;
  saveState();
  renderAll();
  toast('Paramètres de capital enregistrés.');
}

function toggleCouponForm(show) {
  byId('coupon-form').classList.toggle('hidden', !show);
  if (show && !byId('coupon-date').value) {
    byId('coupon-date').value = new Date().toISOString().slice(0, 10);
  }
}

function saveCoupon(event) {
  event.preventDefault();
  const user = currentUser();
  const allocation = getAllocation(user);
  const ledger = getCouponLedger(user);
  const currentCapital = ledger.length ? ledger[ledger.length - 1].capitalAfter : Number(allocation.startingCapital) || 0;
  const odds = Number(byId('coupon-odds').value);
  const stake = Number(byId('coupon-stake').value);
  const result = byId('coupon-result').value;
  const manualGain = byId('coupon-gain').value.trim();
  if (!Number.isFinite(odds) || odds <= 1 || !Number.isSafeInteger(stake) || stake <= 0) {
    return toast('Saisissez une cote supérieure à 1 et une mise valide.');
  }
  if (stake > currentCapital) return toast('La mise dépasse le capital actuel disponible.');
  const maximumRisk = Math.min(
    Number(allocation.maxRisk) > 0 ? Number(allocation.maxRisk) : currentCapital,
    currentCapital * Math.max(0, Number(allocation.riskPercent) || 0) / 100
  );
  if (stake > maximumRisk) {
    return toast(`La mise dépasse votre limite de risque (${money(Math.floor(maximumRisk))}). Modifiez-la dans vos paramètres si nécessaire.`);
  }
  const netResult = result === 'won'
    ? (manualGain === '' ? Math.round(stake * (odds - 1)) : Number(manualGain))
    : -stake;
  if (!Number.isSafeInteger(netResult) || netResult < 0 && result === 'won') {
    return toast('Le gain net saisi est invalide.');
  }
  allocation.coupons.push({
    id: crypto.randomUUID(),
    date: byId('coupon-date').value,
    name: byId('coupon-name').value.trim(),
    odds,
    stake,
    result,
    netResult,
    comment: byId('coupon-comment').value.trim(),
    createdAt: new Date().toISOString()
  });
  saveState();
  event.currentTarget.reset();
  toggleCouponForm(false);
  renderAll();
  toast(`Résultat enregistré : ${netResult >= 0 ? '+' : ''}${money(netResult)}.`);
}

async function changePassword(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const user = currentUser();
  const oldPassword = byId('old-password').value;
  const newPassword = byId('new-password').value;
  const confirmation = byId('confirm-new-password').value;
  if (newPassword.length < 8) return toast('Le nouveau mot de passe doit comporter au moins 8 caractères.');
  if (newPassword !== confirmation) return toast('La confirmation du nouveau mot de passe ne correspond pas.');
  try {
    await passwordMigration;
    if (!(await verifyPassword(user, oldPassword))) return toast('L’ancien mot de passe est incorrect.');
    const credentials = await hashPassword(newPassword);
    user.passwordSalt = credentials.salt;
    user.passwordHash = credentials.hash;
    delete user.password;
    saveState();
    formElement.reset();
    toast('Mot de passe modifié.');
  } catch (error) {
    console.error('La modification du mot de passe a échoué.', error);
    toast(error.message || 'Impossible de modifier le mot de passe.');
  }
}

function saveAppearance(event) {
  event.preventDefault();
  const user = currentUser();
  user.preferences ||= {};
  user.preferences.appearance = byId('appearance-choice').value === 'light' ? 'light' : 'dark';
  renderSettings();
  saveState();
  toast('Apparence enregistrée.');
}

function setDrawerOpen(open) {
  const drawer = byId('side-drawer');
  const mobile = window.matchMedia('(max-width: 900px)').matches;
  drawer.classList.toggle('open', open);
  byId('drawer-backdrop').classList.toggle('open', open);
  drawer.setAttribute('aria-hidden', String(mobile ? !open : false));
  byId('menu-toggle').setAttribute('aria-expanded', String(mobile ? open : true));
  document.body.classList.toggle('drawer-open', mobile && open);
}

async function logout() {
  if (supabaseClient) {
    const { error } = await supabaseClient.auth.signOut();
    if (error) reportSharedPublicationError('Déconnexion administrateur', error);
  }
  state.predictions = state.predictions.map((prediction) => prediction.access === 'vip'
    ? { ...prediction, prediction: '', odds: '', confidence: 0 }
    : prediction);
  state.currentUserId = null;
  sessionStorage.removeItem('tablepro-current-user');
  setDrawerOpen(false);
  saveState();
  showApplication();
  switchEntryTab('login');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (sharedPublicationsReady) {
    try {
      await refreshSharedPublications();
    } catch (error) {
      reportSharedPublicationError('Actualisation après déconnexion', error);
    }
  }
  toast('Déconnexion réussie.');
}

async function updateSharedRow(table, id, changes) {
  if (!supabaseClient) throw new Error('Le client Supabase n’est pas disponible.');
  const { error } = await supabaseClient.from(table).update(changes).eq('id', id);
  if (error) throw error;
}

async function handleAdminTableAction(event) {
  if (!isAdmin()) return;
  const removeRecharge = event.target.closest('[data-remove-recharge]');
  if (removeRecharge) {
    state.rechargeCodes = state.rechargeCodes.filter((code) => code.id !== removeRecharge.dataset.removeRecharge || code.status !== 'available');
    saveState();
    renderAll();
    return toast('Code disponible supprimé.');
  }
  const removePack = event.target.closest('[data-remove-pack]');
  if (removePack) {
    state.rechargePacks = state.rechargePacks.filter((amount) => amount !== Number(removePack.dataset.removePack));
    saveState();
    renderAll();
    return toast('Pack supprimé.');
  }
  const toggle = event.target.closest('[data-toggle-publication]');
  if (toggle) {
    const publication = state.publications.find((item) => item.id === toggle.dataset.togglePublication);
    if (!publication) return;
    const published = !publication.published;
    try {
      await updateSharedRow('tablepro_publications', publication.id, {
        published,
        ...(published ? { ever_published: true } : {})
      });
    } catch (error) {
      return reportSharedPublicationError('Modification de la publication', error);
    }
    publication.everPublished ||= publication.published;
    publication.published = published;
    if (publication.published) publication.everPublished = true;
    publication.predictionIds.forEach((id) => {
      const prediction = state.predictions.find((item) => item.id === id);
      if (prediction) prediction.published = publication.published;
    });
    saveState();
    renderAll();
    return;
  }
  const saveResult = event.target.closest('[data-save-result]');
  if (saveResult) {
    const prediction = state.predictions.find((item) => item.id === saveResult.dataset.saveResult);
    const statusInput = [...byId('admin-predictions-table-body').querySelectorAll('[data-edit-status]')].find((input) => input.dataset.editStatus === prediction?.id);
    if (!prediction || !statusInput) return;
    const publication = state.publications.find((item) => item.id === prediction.publicationId);
    const nextStatus = statusInput.value;
    const nextIsFinal = nextStatus === 'gagné' || nextStatus === 'perdu';
    if (prediction.status !== nextStatus) {
      try {
        await updateSharedRow('tablepro_matches', prediction.id, { status: nextStatus });
      } catch (error) {
        return reportSharedPublicationError('Enregistrement du résultat', error);
      }
    }
    let publicationCompleted = false;
    if (prediction.status !== nextStatus || prediction.resultPublished !== nextIsFinal) {
      const changedAt = new Date().toISOString();
      prediction.resultHistory ||= [];
      prediction.resultHistory.push({
        status: nextStatus,
        resultPublished: nextIsFinal,
        changedAt,
        changedBy: currentUser().id
      });
      prediction.status = nextStatus;
      prediction.resultPublished = nextIsFinal;
      prediction.resultPublishedAt = nextIsFinal ? changedAt : null;
      if (publication) {
        publication.completionHistory ||= [];
        const matches = publication.predictionIds
          .map((id) => state.predictions.find((item) => item.id === id))
          .filter(Boolean);
        const complete = matches.length > 0 && matches.every(isFinalResult);
        if (complete && !publication.completedAt) {
          publication.completedAt = changedAt;
          publication.completionHistory.push({ completedAt: changedAt, completedBy: currentUser().id });
          publicationCompleted = true;
        } else if (!complete) {
          publication.completedAt = null;
        }
      }
      state.adminLogs.push({
        action: 'prediction_result_updated',
        predictionId: prediction.id,
        publicationId: prediction.publicationId,
        status: nextStatus,
        createdAt: changedAt
      });
    }
    saveState();
    renderAll();
    if (publicationCompleted) return toast('LES ANALYSES SONT EN COURS, VEUILLEZ PATIENTER.');
    return toast(nextIsFinal ? 'Résultat publié.' : 'Match remis en attente par l’administrateur.');
  }
  const savePublication = event.target.closest('[data-save-publication]');
  if (savePublication) {
    const publication = state.publications.find((item) => item.id === savePublication.dataset.savePublication);
    const priceInput = [...byId('admin-predictions-table-body').querySelectorAll('[data-edit-price]')].find((input) => input.dataset.editPrice === publication?.id);
    if (!publication) return;
    if (publication.type === 'vip') {
      const price = Number(priceInput?.value);
      if (!Number.isSafeInteger(price) || price <= 0) return toast('Prix VIP invalide.');
      try {
        await updateSharedRow('tablepro_publications', publication.id, { price });
      } catch (error) {
        return reportSharedPublicationError('Enregistrement du prix VIP', error);
      }
      publication.price = price;
      publication.predictionIds.forEach((id) => {
        const prediction = state.predictions.find((item) => item.id === id);
        if (prediction) prediction.price = price;
      });
    }
    saveState();
    renderAll();
    return toast('Publication mise à jour.');
  }
  const removePublication = event.target.closest('[data-delete-publication]');
  if (removePublication) {
    const publication = state.publications.find((item) => item.id === removePublication.dataset.deletePublication);
    if (!publication) return;
    try {
      await updateSharedRow('tablepro_publications', publication.id, { published: false, archived: true });
    } catch (error) {
      return reportSharedPublicationError('Archivage de la publication', error);
    }
    publication.everPublished ||= publication.published;
    publication.published = false;
    publication.archived = true;
    publication.predictionIds.forEach((id) => {
      const prediction = state.predictions.find((item) => item.id === id);
      if (prediction) prediction.published = false;
    });
    saveState();
    renderAll();
    toast('Publication archivée ; historique conservé.');
  }
}

function toggleMemberStatus(event) {
  if (!isAdmin()) return;
  const button = event.target.closest('[data-toggle-user]');
  if (!button) return;
  const user = state.users.find((candidate) => candidate.id === button.dataset.toggleUser);
  if (!user) return;
  user.isActive = !user.isActive;
  state.adminLogs.push({ action: 'member_status_changed', targetUserId: user.id, isActive: user.isActive, createdAt: new Date().toISOString() });
  saveState();
  renderAll();
  toast(user.isActive ? 'Compte réactivé.' : 'Compte désactivé.');
}

byId('entry-signup-form').addEventListener('submit', handleSignup);
byId('entry-login-form').addEventListener('submit', handleLogin);
document.querySelectorAll('[data-entry-tab]').forEach((button) =>
  button.addEventListener('click', () => switchEntryTab(button.dataset.entryTab)));
byId('admin-prediction-form').addEventListener('submit', handlePredictionSubmit);
byId('publication-type').addEventListener('change', () => {
  const simple = byId('publication-type').value === 'simple';
  const forms = byId('publication-match-forms');
  const matches = [...forms.querySelectorAll('.builder-match')];
  if (simple && matches.length > 2) matches.slice(2).forEach((match) => match.remove());
  if (simple && matches.length < 2) while (forms.querySelectorAll('.builder-match').length < 2) addBuilderMatch();
  updatePublicationBuilder();
});
byId('add-publication-match').addEventListener('click', () => {
  if (byId('publication-type').value === 'simple' && byId('publication-match-forms').querySelectorAll('.builder-match').length >= 2) {
    return toast('Une publication simple contient exactement deux matchs.');
  }
  addBuilderMatch();
});
byId('publication-match-forms').addEventListener('input', updatePublicationBuilder);
byId('publication-match-forms').addEventListener('click', (event) => {
  if (!event.target.closest('.remove-builder-match')) return;
  const matches = byId('publication-match-forms').querySelectorAll('.builder-match');
  if (matches.length <= 1) return toast('Une publication doit contenir au moins un match.');
  event.target.closest('.builder-match').remove();
  [...byId('publication-match-forms').querySelectorAll('.builder-match')].forEach((match, index) => {
    match.dataset.index = String(index + 1);
    match.querySelector('.builder-match-title').textContent = `Match ${index + 1}`;
  });
  updatePublicationBuilder();
});
byId('generate-recharge-code').addEventListener('click', generateRechargeCode);
byId('redeem-recharge-code').addEventListener('click', redeemRechargeCode);
byId('recharge-pack-form').addEventListener('submit', updatePack);
byId('balance-adjustment-form').addEventListener('submit', adjustMemberBalance);
byId('admin-tools-root').addEventListener('click', handleAdminTableAction);
byId('admin-users-table-body').addEventListener('click', toggleMemberStatus);
byId('capital-settings-form').addEventListener('submit', saveCapitalSettings);
byId('stake-calculator-form').addEventListener('input', renderCalculator);
byId('coupon-form').addEventListener('submit', saveCoupon);
byId('show-coupon-form').addEventListener('click', () => toggleCouponForm(true));
byId('cancel-coupon-form').addEventListener('click', () => toggleCouponForm(false));
byId('password-change-form').addEventListener('submit', changePassword);
byId('appearance-form').addEventListener('submit', saveAppearance);
byId('menu-toggle').addEventListener('click', () => setDrawerOpen(true));
byId('menu-close').addEventListener('click', () => setDrawerOpen(false));
byId('drawer-backdrop').addEventListener('click', () => setDrawerOpen(false));
byId('drawer-logout').addEventListener('click', logout);
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  const target = link.getAttribute('href').slice(1);
  const mainSection = [...document.querySelector('main').children]
    .some((section) => section.id === target && section.tagName === 'SECTION');
  if (!mainSection) return;
  event.preventDefault();
  if (target === 'admin-panel' && !isAdmin()) return;
  history.replaceState(null, '', `#${target}`);
  showSection(target);
  setDrawerOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setDrawerOpen(false);
});
byId('recharge-pack-select').addEventListener('change', (event) => {
  byId('recharge-amount').value = event.currentTarget.value;
});
byId('recharge-code-input').addEventListener('input', (event) => {
  event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '').slice(0, 12);
});
byId('prediction-list').addEventListener('click', (event) => {
  const button = event.target.closest('.unlock-publication');
  if (button) unlockPrediction(button.dataset.publicationId);
});
byId('vip-publications').addEventListener('click', (event) => {
  const button = event.target.closest('.unlock-publication');
  if (button) unlockPrediction(button.dataset.publicationId);
});
byId('recharge-packs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-pack-amount]');
  if (button) {
    byId('selected-pack-message').textContent = `Pack sélectionné : ${money(button.dataset.packAmount)}. Après paiement, entrez le code de recharge reçu.`;
    document.querySelectorAll('.pack-card').forEach((pack) => pack.classList.toggle('selected', pack === button));
  }
});
byId('copy-referral-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(byId('referral-share-code').value);
    toast('Code d’affiliation copié.');
  } catch (error) {
    byId('referral-share-code').select();
    document.execCommand('copy');
    toast('Code d’affiliation copié.');
  }
});
byId('logout-btn').addEventListener('click', logout);
byId('view-predictions-btn').addEventListener('click', () => {
  location.hash = '#predictions';
});
window.addEventListener('hashchange', () => {
  if (!currentUser()) {
    location.hash = '';
    return;
  }
  if (location.hash === '#admin-panel' && !isAdmin()) location.hash = '#home';
  else showSection(location.hash.slice(1) || 'home');
});
window.addEventListener('resize', () => setDrawerOpen(false));

if (!state.users.some((user) => user.id === 'admin-1')) state.users.unshift(starterState.users[0]);
state.users.forEach((user) => {
  if (user.role !== 'admin' && !user.referralCode) user.referralCode = createReferralCode();
  if (!Array.isArray(user.transactions)) user.transactions = [];
  if (!Array.isArray(user.referrals)) user.referrals = [];
  user.preferences ||= { appearance: 'dark' };
  user.allocation ||= { startingCapital: 0, maxRisk: 0, riskPercent: 2, coupons: [] };
  if (!Array.isArray(user.allocation.coupons)) user.allocation.coupons = [];
  user.unlockedPublications ||= [];
});
state.publications ||= [];
state.publications.forEach((publication) => {
  publication.everPublished ??= Boolean(publication.published);
  publication.archived = Boolean(publication.archived);
});
state.visits ||= [];
state.payments ||= [];
const knownPublicationIds = new Set(state.publications.map((publication) => publication.id));
const legacyFreePredictions = state.predictions.filter((prediction) => prediction.access !== 'vip' && !knownPublicationIds.has(prediction.publicationId));
for (let index = 0; index < legacyFreePredictions.length; index += 2) {
  const group = legacyFreePredictions.slice(index, index + 2);
  const id = `legacy-simple-${group[0].id}`;
  group.forEach((prediction) => { prediction.publicationId = id; });
  state.publications.push({
    id, type: 'simple', title: `Simple — Publication #${String(state.publications.length + 1).padStart(3, '0')}`,
    price: 0, predictionIds: group.map((prediction) => prediction.id),
    published: group.every((prediction) => prediction.published), unlockedBy: [], createdAt: group[0].createdAt
  });
}
state.predictions.filter((prediction) => prediction.access === 'vip').forEach((prediction) => {
  if (knownPublicationIds.has(prediction.publicationId)) return;
  const id = `legacy-vip-${prediction.id}`;
  prediction.publicationId = id;
  state.publications.push({
    id, type: 'vip', title: `VIP — Publication #${String(state.publications.length + 1).padStart(3, '0')}`,
    price: Number(prediction.price) || 500, predictionIds: [prediction.id],
    published: prediction.published, unlockedBy: [], createdAt: prediction.createdAt
  });
});
if (!sessionStorage.getItem('tablepro-visit-recorded')) {
  state.visits.push({ id: crypto.randomUUID(), date: new Date().toISOString(), sessionId: crypto.randomUUID() });
  sessionStorage.setItem('tablepro-visit-recorded', '1');
}
saveState();
switchEntryTab('signup');
passwordMigration = migrateLegacyPasswords();
addBuilderMatch();
addBuilderMatch();
updatePublicationBuilder();
renderAll();
setDrawerOpen(!window.matchMedia('(max-width: 900px)').matches);
initializeSharedPublications();
