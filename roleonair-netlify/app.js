/* =========================================================
 * 1인1역 온에어 — 화면/저장 로직
 *  - 로컬 모드: localStorage (firebase-config.js 가 비어 있을 때)
 *  - 클라우드 모드: Firebase Auth + Firestore (★ 표시 부분)
 * ========================================================= */
(function () {
  'use strict';
  const C = window.Core;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o == null ? null : o));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let toastT;
  function toast(msg, ms = 2600) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
  }


  /* ---------- 저장소 안전 접근 / 확인 창 (브라우저 confirm 대신) ---------- */
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } },
  };
  function ask(msg, opt = {}) {
    return new Promise((resolve) => {
      const w = document.createElement('div'); w.className = 'ask';
      w.innerHTML = `<div class="box"><p>${esc(msg)}</p>${opt.input ? '<input type="password" inputmode="numeric" class="ask-in" id="askInput">' : ''}
        <div class="foot"><button class="btn" data-a="0">취소</button><button class="btn primary" data-a="1">${esc(opt.ok || '확인')}</button></div></div>`;
      document.body.appendChild(w);
      const inp = w.querySelector('input'); (inp || w.querySelector('[data-a="1"]')).focus();
      const end = (ok) => { w.remove(); resolve(opt.input ? (ok ? inp.value : null) : ok); };
      w.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (b) end(b.dataset.a === '1'); });
      w.addEventListener('keydown', (e) => { if (e.key === 'Enter') end(true); if (e.key === 'Escape') end(false); });
    });
  }

  /* ---------------- 기본값 ---------------- */
  const EXAMPLE_ROLES = [
    ['칠판 지기', '쉬는 시간마다 칠판을 깨끗하게 지워요', 1],
    ['우유 도우미', '우유 상자를 가져오고 빈 팩을 정리해요', 2],
    ['급식 도우미', '배식 준비와 급식대 정리를 도와요', 2],
    ['분리수거 지기', '교실 분리수거함을 정리하고 버려요', 2],
    ['식물 지기', '교실 화분에 물을 주고 잘 자라는지 살펴요', 1],
    ['전등·창문 지기', '이동 수업·하교 때 불을 끄고 창문을 닫아요', 1],
    ['컴퓨터 도우미', '수업 전 컴퓨터·TV 켜고 끄기를 도와요', 1],
    ['우편 배달부', '가정통신문과 학습지를 나눠 줘요', 2],
    ['학급 문고 지기', '책꽂이의 책을 가지런히 정리해요', 1],
    ['신발장 지기', '신발장 정리 상태를 살펴요', 1],
    ['사물함 점검', '사물함 위와 주변을 정리해요', 1],
    ['출석 도우미', '아침에 친구들 출석과 건강 상태를 확인해요', 1],
    ['알림장 지기', '오늘의 알림 내용을 칠판에 적어요', 1],
    ['청소 도구 지기', '빗자루·걸레를 제자리에 정리해요', 1],
    ['바닥 점검', '하교 전 교실 바닥 쓰레기를 살펴요', 2],
    ['에너지 지킴이', '냉난방기와 전기 낭비를 살펴요', 1],
    ['체육 도우미', '체육 시간 준비물을 챙기고 정리해요', 2],
    ['보건 도우미', '아픈 친구를 보건실에 데려다 줘요', 1],
    ['시간 지킴이', '수업 시작 시간을 알려 줘요', 1],
    ['환경 미화', '게시판과 교실 꾸미기를 도와요', 1],
  ];
  function defaults() {
    return {
      className: '우리 반', maxChoices: 7, minChoices: 3, allowDouble: true, mode: 'fair', usePin: false,
      roles: EXAMPLE_ROLES.map(([name, desc, count]) => ({ id: C.uid(), name, desc, count, repeatable: true })),
      students: [], prevRoles: {}, prevByName: {},
      peer: { enabled: true, male: 2, female: 2, votesPerGender: 2, candidates: 'all', title: '또래상담자',
        desc: '친구의 고민을 들어 주고 함께 해결 방법을 찾는 봉사 역할이에요. 1인1역과 함께 맡아요.' },
      prefsOpen: false, votesOpen: false, peerCandidates: null,
    };
  }
  const S = { settings: defaults(), prefs: {}, votes: {}, result: null, peerPick: null, pins: {}, tab: 'settings', tie: { male: [], female: [] } };
  const T = () => S.settings;
  const studentByNo = (no) => T().students.find((s) => +s.no === +no);
  const roleById = (id) => T().roles.find((r) => r.id === id);
  const nameOf = (no) => (studentByNo(no) || {}).name || `${no}번`;

  /* =========================================================
   * 반코드 (6자리 숫자) — 로컬·클라우드 공통
   * ========================================================= */
  const gen6 = () => String(Math.floor(100000 + Math.random() * 900000));
  const isCode = (s) => /^\d{6}$/.test(String(s || ''));
  const KEY = 'roleonair:v1';            // 예전 버전(학급 1개) 저장 키 → 자동으로 옮김
  const IDX = 'roleonair:classes';       // 이 기기의 학급 목록
  const CUR = 'roleonair:cur';           // 지금 연 학급
  const GRADE = 'roleonair:grade';       // 이 기기의 학년 공간(역할 세트)
  function applyData(d) {
    d = d || {};
    S.settings = { ...defaults(), ...(d.settings || {}), peer: { ...defaults().peer, ...((d.settings || {}).peer || {}) } };
    S.prefs = d.prefs || {}; S.votes = d.votes || {}; S.result = d.result || null; S.peerPick = d.peerPick || null; S.pins = d.pins || {};
    S.teacherKey = d.teacherKey || ''; S.tie = { male: [], female: [] };
  }

  /* =========================================================
   * 저장소 ① 로컬 (이 기기)
   * ========================================================= */
  const Local = {
    kind: 'local', id: null, // id = 반코드
    list() { try { return JSON.parse(LS.get(IDX) || '[]'); } catch (e) { return []; } },
    setList(l) { LS.set(IDX, JSON.stringify(l)); },
    dataKey(id) { return 'roleonair:c:' + id; },
    readClass(id) { try { return JSON.parse(LS.get(this.dataKey(id)) || 'null'); } catch (e) { return null; } },
    has(code) { return this.list().some((c) => c.id === code); },
    migrate() {
      const list = this.list();
      const old = LS.get(KEY);
      if (old && !list.length) { // 예전(1개 학급) 데이터를 반코드 학급으로 옮기기
        const id = gen6(); LS.set(this.dataKey(id), old);
        let nm = '우리 반'; try { nm = JSON.parse(old).settings.className || nm; } catch (e) { /* 기본 이름 */ }
        this.setList([{ id, name: nm }]); LS.del(KEY);
      }
    },
    recent() { return this.list().map((c) => ({ code: c.id, name: c.name })); },
    async exists(code) { return this.has(code); },
    async needsKey(code) { const d = this.readClass(code); return !!(d && d.teacherKey); },
    async create(name, key, roles) {
      let code; do code = gen6(); while (this.has(code));
      const l = this.list(); l.push({ id: code, name }); this.setList(l);
      applyData({}); S.settings.className = name; S.teacherKey = key || '';
      if (roles) S.settings.roles = clone(roles).map((r) => ({ ...r, id: C.uid() }));
      this.id = code; LS.set(CUR, code); this.saveAll(); return code;
    },
    async join(code, key) {
      const d = this.readClass(code);
      if (!d) throw new Error('이 기기에 그 반코드가 없어요. 클라우드 모드에서는 어느 기기에서나 열 수 있어요.');
      if (d.teacherKey && d.teacherKey !== key) throw new Error('비밀번호가 달라요.');
    },
    async open(code) { this.id = code; LS.set(CUR, code); applyData(this.readClass(code)); },
    leave() { this.id = null; LS.del(CUR); },
    async remove(code) { this.setList(this.list().filter((c) => c.id !== code)); LS.del(this.dataKey(code)); if (this.id === code) this.leave(); },
    saveAll() {
      if (!this.id) return;
      try { localStorage.setItem(this.dataKey(this.id), JSON.stringify({ settings: S.settings, prefs: S.prefs, votes: S.votes, result: S.result, peerPick: S.peerPick, pins: S.pins, teacherKey: S.teacherKey })); }
      catch (e) { toast('저장 공간이 부족해요. 백업 후 다른 학급을 지워 주세요.'); }
      const l = this.list(); const c = l.find((x) => x.id === this.id);
      if (c && c.name !== S.settings.className) { c.name = S.settings.className; this.setList(l); }
    },
    saveSettings() { this.saveAll(); },
    async savePref(no, p) { S.prefs[no] = p; this.saveAll(); },
    async deletePref(no) { delete S.prefs[no]; this.saveAll(); },
    async saveVote(no, v) { S.votes[no] = v; this.saveAll(); },
    async deleteVote(no) { delete S.votes[no]; this.saveAll(); },
    async clearVotes() { S.votes = {}; this.saveAll(); },
    async clearPrefs() { S.prefs = {}; this.saveAll(); },
    async saveResult() { this.saveAll(); },
    async savePins() { this.saveAll(); },
    async setLive(state) { S.settings.live = { state, at: Date.now() }; this.saveAll(); },
    async changeKey(k) { S.teacherKey = k; this.saveAll(); },
    async readOtherRoles(code) {
      const d = this.readClass(code); if (!d) throw new Error('이 기기에 그 반코드가 없어요.');
      return ((d.settings || {}).roles) || [];
    },
  };

  /* ---------- 학년 현황용 요약(보드) 만들기 ---------- */
  // 학급 데이터 → 다른 선생님에게 보여 줄 최종 역할표 요약
  function buildBoard(st, res, peerPick, extra = {}) {
    if (!res || !res.byStudent) return null;
    const nm = (no) => ((st.students || []).find((s) => +s.no === +no) || {}).name || `${no}번`;
    const roleName = (id) => ((st.roles || []).find((r) => r.id === id) || {}).name;
    const byRole = {}; (st.roles || []).forEach((r) => (byRole[r.id] = []));
    Object.entries(res.byStudent).forEach(([no, l]) => l.forEach((x) => byRole[x.roleId] && byRole[x.roleId].push(+no)));
    const peerSet = new Set(peerPick ? [...(peerPick.male || []), ...(peerPick.female || [])] : []);
    return clone({
      className: st.className, at: res.at || Date.now(), ...extra,
      roles: (st.roles || []).filter((r) => r.count > 0).map((r) => ({ name: r.name, desc: r.desc || '', names: byRole[r.id].sort((a, b) => a - b).map(nm) })),
      students: (st.students || []).map((s) => ({ no: s.no, name: s.name, roles: (res.byStudent[s.no] || []).map((x) => roleName(x.roleId)).filter(Boolean), peer: peerSet.has(+s.no) })),
      peer: peerPick && st.peer && st.peer.enabled ? { title: st.peer.title, desc: st.peer.desc, male: (peerPick.male || []).map(nm), female: (peerPick.female || []).map(nm) } : null,
    });
  }
  const myBoard = () => buildBoard(T(), S.result, S.peerPick, { code: curCode() });

  /* ---------- 학년 공간 ① 이 기기 (이 기기의 반들이 한 학년) ---------- */
  const LocalGrade = {
    kind: 'local',
    data() { try { return JSON.parse(LS.get(GRADE) || 'null') || { name: '우리 학년', templates: [] }; } catch (e) { return { name: '우리 학년', templates: [] }; } },
    put(d) { LS.set(GRADE, JSON.stringify(d)); },
    async get() { const d = this.data(); return { id: 'local', name: d.name, local: true, members: Local.recent().map((c) => ({ code: c.code, className: c.name })) }; },
    async rename(name) { const d = this.data(); d.name = name; this.put(d); },
    async listTemplates() { return this.data().templates.slice().sort((a, b) => b.at - a.at).map((t) => ({ ...t, mine: true })); },
    async saveTemplate(name, roles) { const d = this.data(); d.templates.push({ id: C.uid(), name, roles: clone(roles), byName: T().className, at: Date.now() }); this.put(d); },
    async deleteTemplate(id) { const d = this.data(); d.templates = d.templates.filter((t) => t.id !== id); this.put(d); },
    async listBoards() {
      Local.saveAll();
      return Local.list().map((c) => {
        const d = Local.readClass(c.id); if (!d) return null;
        const st = { ...defaults(), ...d.settings };
        return buildBoard(st, d.result, d.peerPick, { code: c.id, mine: c.id === Local.id });
      }).filter(Boolean);
    },
    async publishBoard() { /* 로컬은 자동 */ },
  };

  /* =========================================================
   * 저장소 ② 클라우드 (Firebase)  ★
   *  - 로그인 없음: 모든 사용자는 Firebase '익명 로그인'
   *  - 선생님 확인: 반코드 + 선생님 비밀번호 (서버 규칙이 비교)
   * ========================================================= */
  // ★ Firebase SDK 버전 (필요하면 최신 버전 번호로 바꾸세요)
  const FB_VER = '10.12.2';
  const FB = {}; // 불러온 Firebase 함수들
  async function loadFirebase() {
    // ★ Firebase 모듈을 CDN에서 불러옵니다 (별도 설치 불필요)
    const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
    const [app, auth, fs] = await Promise.all([
      import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js'),
    ]);
    // ★ firebase-config.js 의 설정으로 초기화
    FB.app = app.initializeApp(window.FIREBASE_CONFIG);
    FB.auth = auth.getAuth(FB.app);
    FB.db = fs.getFirestore(FB.app);
    Object.assign(FB, auth, fs);
    // ★ 익명 로그인 (Firebase 콘솔 → Authentication → 로그인 방법 → '익명' 사용 설정 필요)
    await new Promise((res) => { const u = FB.onAuthStateChanged(FB.auth, (user) => { if (user) { u(); res(); } }); });
    Cloud.uid = FB.auth.currentUser.uid;
  }
  async function ensureAnon() { if (!FB.auth.currentUser) await FB.signInAnonymously(FB.auth); }
  const publicSettings = () => clone({ ...S.settings });
  const RECENT = 'roleonair:recent';

  const Cloud = {
    kind: 'cloud', uid: null, code: null, unsubs: [], saveT: null,
    cref(code, ...p) { return FB.doc(FB.db, 'classes', code, ...p); },
    ref(...p) { return this.cref(this.code, ...p); },
    col(name) { return FB.collection(FB.db, 'classes', this.code, name); },
    recent() { try { return JSON.parse(LS.get(RECENT) || '[]'); } catch (e) { return []; } },
    addRecent(code, name) { const l = this.recent().filter((c) => c.code !== code); l.unshift({ code, name }); LS.set(RECENT, JSON.stringify(l.slice(0, 12))); },
    async exists(code) { return (await FB.getDoc(this.cref(code))).exists(); },
    async isOwner(code) { try { return (await FB.getDoc(this.cref(code, 'owners', this.uid))).exists(); } catch (e) { return false; } },
    async needsKey(code) { return !(await this.isOwner(code)); },
    async create(name, key, roles) {
      let code = gen6();
      for (let i = 0; i < 8 && (await this.exists(code)); i++) code = gen6();
      const st = defaults(); st.className = name || '우리 반';
      if (roles) st.roles = clone(roles).map((r) => ({ ...r, id: C.uid() }));
      // ★ 반 만들기: 학급 + 비밀번호(비공개) + 나를 담임으로 등록 — 한 번에 저장
      const b = FB.writeBatch(FB.db);
      b.set(this.cref(code), { pub: clone(st), createdAt: FB.serverTimestamp(), updatedAt: FB.serverTimestamp() });
      b.set(this.cref(code, 'private', 'admin'), { key });
      b.set(this.cref(code, 'owners', this.uid), { key, at: Date.now() });
      await b.commit();
      this.addRecent(code, st.className);
      return code;
    },
    async join(code, key) {
      if (!(await this.exists(code))) throw new Error('없는 반코드예요.');
      if (await this.isOwner(code)) return;
      // ★ 비밀번호가 맞으면 규칙이 '담임 등록'을 허락함 (같은 학년 다른 선생님·공동 담임도 이렇게 들어옴)
      try { await FB.setDoc(this.cref(code, 'owners', this.uid), { key, at: Date.now() }); }
      catch (e) { throw new Error('비밀번호가 달라요.'); }
    },
    async open(code) {
      this.unsubs.forEach((u) => u()); this.unsubs = [];
      this.code = code; LS.set('roleonair:class', code);
      const snap = await FB.getDoc(this.ref());
      if (!snap.exists()) throw new Error('학급을 찾을 수 없어요.');
      applyData({ settings: snap.data().pub });
      const r = await FB.getDoc(this.ref('result', 'current'));
      if (r.exists()) { const rd = r.data(); S.peerPick = rd.peer || null; delete rd.peer; S.result = rd.byStudent ? rd : null; if (S.result) S.result.published = !!rd.published; }
      const pins = await FB.getDocs(this.col('secrets'));
      pins.forEach((p) => (S.pins[p.id] = p.data().pin));
      this.addRecent(code, S.settings.className);
      // ★ 실시간 반영: 학생들이 제출하면 바로 화면에 나타남
      this.unsubs.push(FB.onSnapshot(this.col('prefs'), (qs) => {
        S.prefs = {}; qs.forEach((x) => (S.prefs[x.id] = x.data()));
        syncPeerCandidates(); liveRefresh();
      }));
      this.unsubs.push(FB.onSnapshot(this.col('votes'), (qs) => {
        S.votes = {}; qs.forEach((x) => (S.votes[x.id] = x.data())); liveRefresh();
      }));
    },
    leave() { this.unsubs.forEach((u) => u()); this.unsubs = []; this.code = null; LS.del('roleonair:class'); },
    saveSettings() {
      clearTimeout(this.saveT);
      this.saveT = setTimeout(() => {
        FB.updateDoc(this.ref(), { pub: publicSettings(), updatedAt: FB.serverTimestamp() })
          .catch((e) => toast('저장 실패: ' + e.message));
      }, 500);
    },
    async savePref(no, p) { await FB.setDoc(this.ref('prefs', String(no)), { ...p, no: +no, uid: this.uid }); },
    async deletePref(no) { await FB.deleteDoc(this.ref('prefs', String(no))); },
    async saveVote(no, v) { await FB.setDoc(this.ref('votes', String(no)), { ...v, no: +no, uid: this.uid }); },
    async deleteVote(no) { await FB.deleteDoc(this.ref('votes', String(no))); },
    async clearVotes() { await batchDelete(this.col('votes')); },
    async clearPrefs() { await batchDelete(this.col('prefs')); },
    async saveResult() {
      const data = clone({ ...(S.result || {}), peer: S.peerPick || null, published: !!(S.result && S.result.published) });
      await FB.setDoc(this.ref('result', 'current'), data);
      if (T().gradeCode && T().shareBoard !== false) Grade.publishBoard().catch((e) => console.warn(e));
    },
    async savePins() {
      const b = FB.writeBatch(FB.db);
      Object.entries(S.pins).forEach(([no, pin]) => b.set(this.ref('secrets', String(no)), { pin }));
      await b.commit();
    },
    // ★ 생방송 신호: 학생 화면이 이 값을 실시간으로 보고 뽑기 연출·결과 발표를 따라감
    async setLive(state) {
      S.settings.live = { state, at: Date.now() };
      await FB.updateDoc(this.ref(), { 'pub.live': S.settings.live, updatedAt: FB.serverTimestamp() });
    },
    async changeKey(k) {
      await FB.setDoc(this.ref('private', 'admin'), { key: k });
      await FB.setDoc(this.ref('owners', this.uid), { key: k, at: Date.now() });
    },
    async readOtherRoles(code) {
      const s = await FB.getDoc(this.cref(code));
      if (!s.exists()) throw new Error('없는 반코드예요.');
      return ((s.data().pub || {}).roles) || [];
    },
  };
  async function batchDelete(colRef) {
    const qs = await FB.getDocs(colRef); const b = FB.writeBatch(FB.db);
    qs.forEach((d) => b.delete(d.ref)); await b.commit();
  }

  /* ---------- 학년 공간 ② 클라우드 (학년코드 6자리로 여러 선생님이 공유) ---------- */
  const CloudGrade = {
    kind: 'cloud',
    gref(...p) { return FB.doc(FB.db, 'grades', T().gradeCode, ...p); },
    gcol(name) { return FB.collection(FB.db, 'grades', T().gradeCode, name); },
    async create(name) {
      let code = gen6();
      for (let i = 0; i < 8 && (await FB.getDoc(FB.doc(FB.db, 'grades', code))).exists(); i++) code = gen6();
      await FB.setDoc(FB.doc(FB.db, 'grades', code), { name: name || '우리 학년', createdAt: Date.now() });
      await this.join(code); return code;
    },
    async join(code) {
      const g = await FB.getDoc(FB.doc(FB.db, 'grades', code));
      if (!g.exists()) throw new Error('없는 학년코드예요.');
      await FB.setDoc(FB.doc(FB.db, 'grades', code, 'members', Cloud.code), { className: T().className, at: Date.now() });
      T().gradeCode = code; saveSettings();
      if (S.result) this.publishBoard().catch(() => {});
    },
    async leave() {
      try { await FB.deleteDoc(this.gref('members', Cloud.code)); await FB.deleteDoc(this.gref('boards', Cloud.code)); } catch (e) { /* 이미 없음 */ }
      T().gradeCode = ''; saveSettings();
    },
    async get() {
      if (!T().gradeCode) return null;
      const g = await FB.getDoc(this.gref());
      if (!g.exists()) return null;
      const ms = await FB.getDocs(this.gcol('members'));
      return { id: g.id, name: g.data().name, members: ms.docs.map((d) => ({ code: d.id, ...d.data() })) };
    },
    async rename(name) { await FB.updateDoc(this.gref(), { name }); },
    async listTemplates() {
      const qs = await FB.getDocs(this.gcol('templates'));
      return qs.docs.map((d) => ({ id: d.id, ...d.data(), mine: d.data().classCode === Cloud.code })).sort((a, b) => b.at - a.at);
    },
    async saveTemplate(name, roles) {
      await FB.addDoc(this.gcol('templates'), { name, roles: clone(roles), byName: T().className, classCode: Cloud.code, at: Date.now() });
    },
    async deleteTemplate(id) { await FB.deleteDoc(this.gref('templates', id)); },
    async listBoards() {
      const qs = await FB.getDocs(this.gcol('boards'));
      return qs.docs.map((d) => ({ ...d.data(), code: d.id, mine: d.id === Cloud.code }));
    },
    async publishBoard() {
      const b = myBoard(); if (!b || !T().gradeCode) return;
      await FB.setDoc(this.gref('boards', Cloud.code), b);
    },
  };

  let Store = Local;
  let Grade = LocalGrade;
  const curCode = () => (Store.kind === 'local' ? Local.id : Cloud.code);
  const saveSettings = () => { syncPeerCandidates(true); Store.saveSettings(); $('#classLabel').textContent = T().className; };

  function syncPeerCandidates(silent) {
    const st = T();
    const next = st.peer.candidates === 'volunteer'
      ? st.students.filter((s) => S.prefs[s.no] && S.prefs[s.no].peerVolunteer).map((s) => +s.no) : null;
    if (JSON.stringify(next) !== JSON.stringify(st.peerCandidates)) {
      st.peerCandidates = next;
      if (!silent) Store.saveSettings();
    }
  }
  // 결과가 바뀌면: 저장 + (클라우드·공개 중이면) 학생 화면 다시 발표
  async function resultChanged() {
    await Store.saveResult();
    if (Store.kind === 'cloud' && S.result && S.result.published) Store.setLive('reveal').catch(() => {});
  }

  /* =========================================================
   * 상단 / 탭
   * ========================================================= */
  function renderTop() {
    const inClass = !!curCode();
    $('#tabs').hidden = !inClass;
    $('#classLabel').textContent = inClass ? T().className : '반코드로 시작하는 1인1역 뽑기';
    const tr = $('#topRight');
    const mode = Store.kind === 'local' ? '<span class="pill local">이 기기 저장</span>' : '<span class="pill cloud">클라우드</span>';
    tr.innerHTML = inClass
      ? `${mode}<span class="pill code" title="학생 입장 코드">반코드 <b>${esc(curCode())}</b></span><button class="btn sm" data-act="leaveClass">반 나가기</button>`
      : mode;
  }
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    S.tab = b.dataset.tab; render();
  });
  function render() {
    renderTop();
    const m = $('#main');
    const banner = window.PREVIEW ? `<div class="note warn preview-note"><b>미리보기</b><span>예시 반 2개(5학년 1반·2반)가 들어 있어요. 선생님 비밀번호는 <b>000000</b>. 이 브라우저에만 저장돼요.</span></div>` : '';
    if (!curCode()) { m.innerHTML = banner + viewLanding(); return; }
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
    if (S.tab === 'settings') m.innerHTML = viewSettings();
    if (S.tab === 'prefs') { m.innerHTML = viewPrefs(); drawQR(); }
    if (S.tab === 'peer') m.innerHTML = viewPeer();
    if (S.tab === 'result') m.innerHTML = viewResult();
    if (S.tab === 'grade') { m.innerHTML = viewGradeShell(); loadGrade(); }
    if (banner) m.insertAdjacentHTML('afterbegin', banner);
    updateSummary();
  }
  let liveT;
  function liveRefresh() {
    if (!$('#kiosk').hidden) return;
    clearTimeout(liveT);
    liveT = setTimeout(() => { if (S.tab === 'prefs' || S.tab === 'peer') render(); }, 250);
  }

  /* =========================================================
   * 첫 화면 — 반코드로 시작
   * ========================================================= */
  const clockTime = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const clockDay = () => { const d = new Date(); return `${d.getMonth() + 1}.${d.getDate()} ${'일월화수목금토'[d.getDay()]} · LIVE`; };
  setInterval(() => { const t = document.getElementById('tallyTime'); if (t) t.textContent = clockTime(); }, 15000);
  function viewLanding() {
    const recent = Store.recent();
    const cloud = Store.kind === 'cloud';
    return `
    <div class="landing">
      <section class="onair-hero">
        <span class="lamp big"></span>
        <div><div class="eyebrow">ON AIR</div><h1>1인1역, 생방송으로 뽑아요</h1>
        <p>선생님은 반을 만들고 6자리 <b>반코드</b>를 알려 주세요. 학생은 반코드로 들어와 희망을 고르고, 뽑기는 ${cloud ? '모든 학생 화면에 생방송으로' : '교실 화면에서'} 나와요.</p></div>
        <div class="tally" aria-hidden="true"><span id="tallyDay">${clockDay()}</span><b id="tallyTime">${clockTime()}</b></div>
      </section>
      <div class="land-grid">
        <section class="card">
          <h2>선생님</h2>
          ${recent.length ? `<div class="lbl" style="margin-top:8px">${cloud ? '이 기기에서 열었던 반' : '이 기기의 반'}</div>
            <div class="recent">${recent.map((c) => `<button class="recent-btn" data-act="openRecent" data-code="${esc(c.code)}"><span>${esc(c.name)}</span><code>${esc(c.code)}</code></button>`).join('')}</div>` : ''}
          <details class="land-box" ${recent.length ? '' : 'open'}>
            <summary>＋ 새 반 만들기</summary>
            <div class="field"><label for="nClass">반 이름</label><input type="text" id="nClass" placeholder="예: 5학년 2반"></div>
            <div class="field"><label for="nKey">선생님 비밀번호 (6자 이상)</label><input type="password" id="nKey" autocomplete="new-password" placeholder="반을 다시 열 때 필요해요"></div>
            <button class="btn primary" data-act="createClass">반 만들고 반코드 받기</button>
          </details>
          <details class="land-box">
            <summary>반코드로 열기 ${cloud ? '(다른 기기 · 공동 담임)' : ''}</summary>
            <div class="row"><input type="text" id="oCode" inputmode="numeric" maxlength="6" placeholder="반코드 6자리" style="width:140px">
              <input type="password" id="oKey" placeholder="선생님 비밀번호" style="flex:1;min-width:140px"><button class="btn primary" data-act="openByCode">열기</button></div>
          </details>
        </section>
        <section class="card student-card">
          <h2>학생</h2>
          <p class="muted small">선생님이 알려 준 반코드 6자리를 넣어요.</p>
          <input type="text" id="sCode" class="code-input" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="off">
          <button class="btn big red" data-act="studentEnter" style="width:100%">입장하기 ▶</button>
          ${cloud ? '' : '<p class="small muted">이 기기 저장 모드에서는 이 기기에 만든 반만 들어갈 수 있어요.</p>'}
        </section>
      </div>
    </div>`;
  }
  async function enterClass(code) {
    await Store.open(code); S.tab = S.tab === 'grade' ? 'grade' : 'settings';
    if (Store.kind === 'local') Local.saveAll();
    render();
  }

  const sw = (attrs, checked, label) => `<label class="switch"><input type="checkbox" ${attrs} ${checked ? 'checked' : ''}><span class="k"></span>${label ? `<span>${label}</span>` : ''}</label>`;

  /* =========================================================
   * ① 설정
   * ========================================================= */
  function viewSettings() {
    const st = T();
    const roleRows = st.roles.map((r, i) => `
      <tr>
        <td class="small muted">${i + 1}</td>
        <td class="rname"><input type="text" data-role="${r.id}" data-f="name" value="${esc(r.name)}" placeholder="역할 이름"></td>
        <td class="rdesc"><input type="text" data-role="${r.id}" data-f="desc" value="${esc(r.desc)}" placeholder="이 역할이 하는 일"></td>
        <td><input type="number" min="0" max="9" data-role="${r.id}" data-f="count" value="${r.count}"></td>
        <td>${sw(`data-role="${r.id}" data-f="repeatable"`, r.repeatable !== false, '')}</td>
        <td><button class="x" data-act="delRole" data-id="${r.id}" title="삭제">×</button></td>
      </tr>`).join('');
    const stuRows = st.students.map((s) => `
      <tr>
        <td class="num"><input type="text" data-stu="${s.no}" data-f="no" value="${s.no}" style="width:48px"></td>
        <td><input type="text" data-stu="${s.no}" data-f="name" value="${esc(s.name)}"></td>
        <td><select data-stu="${s.no}" data-f="gender">
          <option value="" ${!s.gender ? 'selected' : ''}>-</option><option ${s.gender === '남' ? 'selected' : ''}>남</option><option ${s.gender === '여' ? 'selected' : ''}>여</option></select></td>
        <td><input type="text" data-stu="${s.no}" data-f="prev" value="${esc((st.prevRoles[s.no] || []).join(', '))}" placeholder="예: 칠판 지기"></td>
        <td><button class="x" data-act="delStu" data-no="${s.no}" title="삭제">×</button></td>
      </tr>`).join('');
    const p = st.peer;
    return `
    <div class="grid2">
      <div>
        ${viewClassInfo()}
        <section class="card">
          <div class="card-h"><div><h2>학급 · 배정 규칙</h2><p class="muted small">학생들이 희망하는 역할 수와 배정 방식을 정해요.</p></div></div>
          <div class="field"><label>학급 이름</label><input type="text" data-k="className" value="${esc(st.className)}"></div>
          <div class="row">
            <div class="field"><label>희망 순위 최대</label><select data-k="maxChoices" data-type="num">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option ${n === st.maxChoices ? 'selected' : ''} value="${n}">${n}지망까지</option>`).join('')}</select></div>
            <div class="field"><label>최소 선택 수</label><select data-k="minChoices" data-type="num">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option ${n === st.minChoices ? 'selected' : ''} value="${n}">${n}개 이상</option>`).join('')}</select></div>
            <div class="field"><label>배정 방식</label><select data-k="mode">
              <option value="fair" ${st.mode === 'fair' ? 'selected' : ''}>골고루 (낮은 지망 최소화)</option>
              <option value="first" ${st.mode === 'first' ? 'selected' : ''}>1지망 많이</option></select></div>
          </div>
          <div class="field">${sw('data-k="allowDouble" data-type="bool"', st.allowDouble, '자리가 남으면 1인 2역 허용 (희망한 학생 먼저)')}</div>
          <p class="small muted" style="margin:0">같은 지망끼리 겹치면 컴퓨터가 공정하게 추첨해요. 직전에 했던 역할 중 ‘다시 가능’이 꺼진 역할은 그 학생에게 배정되지 않아요.</p>
        </section>

        <section class="card">
          <div class="card-h">
            <div><h2>학생 명단</h2><p class="muted small">나이스 학생명렬표 엑셀(.xlsx, .xls)을 그대로 올리거나 직접 입력하세요.</p></div>
            <div class="row">
              <span class="btn file-btn sm">나이스 엑셀 불러오기<input type="file" data-file="roster" accept=".xlsx,.xls,.csv,.xlsm"></span>
              <button class="btn sm" data-act="rosterText">직접 입력</button>
            </div>
          </div>
          ${st.students.length ? `<div class="tbl-wrap scroll"><table class="tbl"><thead><tr><th>번호</th><th>이름</th><th>성별</th><th>직전 역할 <span title="쉼표로 여러 개">ⓘ</span></th><th></th></tr></thead><tbody>${stuRows}</tbody></table></div>
            <div class="row" style="margin-top:8px"><button class="btn sm" data-act="addStu">+ 학생 추가</button><button class="btn sm ghost" data-act="clearStu">명단 비우기</button></div>`
          : `<div class="note warn">아직 학생 명단이 없어요. 엑셀을 올리거나 직접 입력해 주세요.</div>`}
          <div id="stuSummary"></div>
        </section>
      </div>

      <div>
        <section class="card">
          <div class="card-h">
            <div><h2>역할 만들기</h2><p class="muted small">역할마다 인원(2명이 함께 할 수도 있어요)과 다시 맡기 가능 여부를 정해요.</p></div>
            <div class="row">
              <span class="btn file-btn sm">직전 역할 파일 불러오기<input type="file" data-file="prev" accept=".hwp,.hwpx,.pdf,.xlsx,.xls,.csv,.txt"></span>
            </div>
          </div>
          <div class="tbl-wrap scroll"><table class="tbl">
            <thead><tr><th>#</th><th>역할</th><th>하는 일 (간단 안내)</th><th>인원</th><th title="직전에 이 역할을 한 학생이 다시 할 수 있나요?">다시 가능</th><th></th></tr></thead>
            <tbody>${roleRows || `<tr><td colspan="6" class="muted">역할이 없어요.</td></tr>`}</tbody></table></div>
          <div class="row" style="margin-top:8px">
            <button class="btn sm" data-act="addRole">+ 역할 추가</button>
            <button class="btn sm" data-act="allRepeat" data-v="0">모두 ‘다시 불가’</button>
            <button class="btn sm" data-act="allRepeat" data-v="1">모두 ‘다시 가능’</button>
            <button class="btn sm ghost" data-act="exampleRoles">예시 역할로</button>
            <button class="btn sm ghost" data-act="clearRoles">모두 지우기</button>
          </div>
          <div id="seatSummary"></div>
          <p class="small muted" style="margin:10px 0 0">한글(.hwp/.hwpx)·PDF·엑셀로 된 지난 역할표를 올리면 역할 이름·하는 일·맡았던 학생을 찾아 줘요. 결과를 확인하고 적용할 수 있어요.</p>
        </section>

        <section class="card">
          <div class="card-h"><div><h2>또래상담자</h2><p class="muted small">1인1역과 별도로 겹쳐서 맡는 봉사 역할. 반 친구들의 투표로 정해요.</p></div>
            ${sw('data-k="peer.enabled" data-type="bool"', p.enabled, '사용')}</div>
          <div class="row">
            <div class="field"><label>남학생</label><input type="number" min="0" max="9" data-k="peer.male" data-type="num" value="${p.male}"></div>
            <div class="field"><label>여학생</label><input type="number" min="0" max="9" data-k="peer.female" data-type="num" value="${p.female}"></div>
            <div class="field"><label>1인당 투표 (성별마다)</label><input type="number" min="1" max="5" data-k="peer.votesPerGender" data-type="num" value="${p.votesPerGender}"></div>
            <div class="field"><label>후보</label><select data-k="peer.candidates">
              <option value="all" ${p.candidates === 'all' ? 'selected' : ''}>반 전체</option>
              <option value="volunteer" ${p.candidates === 'volunteer' ? 'selected' : ''}>하고 싶다고 한 학생만</option></select></div>
          </div>
          <div class="field"><label>학생에게 보이는 안내</label><input type="text" data-k="peer.desc" value="${esc(p.desc)}"></div>
          <p class="small muted" style="margin:0">자기 자신은 뽑을 수 없고, 가장 많은 표를 받은 학생이 선정돼요. 동점이면 선생님이 추첨하거나 직접 골라요.</p>
        </section>

        <section class="card">
          <div class="card-h"><div><h2>확인코드 · 데이터</h2><p class="muted small">다른 친구 번호로 입력하는 것을 막으려면 학생별 4자리 확인코드를 쓰세요.</p></div></div>
          <div class="field">${sw('data-k="usePin" data-type="bool"', st.usePin, '학생 확인코드 사용')}</div>
          <div class="row">
            <button class="btn sm" data-act="genPins">확인코드 만들기</button>
            ${window.PREVIEW ? '' : `<button class="btn sm" data-act="printPins" ${Object.keys(S.pins).length ? '' : 'disabled'}>확인코드 카드 인쇄</button>`}
            <span class="small muted">${Object.keys(S.pins).length}명 코드 있음</span>
          </div>
          <div class="field" style="margin-top:12px"><label>학생 화면에서 나갈 때 선생님 비밀번호 (이 기기에만 저장)</label>
            <input type="password" inputmode="numeric" id="tpin" value="${esc(LS.get('roleonair:tpin') || '')}" placeholder="비워두면 확인 없이 나가요" style="max-width:220px"></div>
          <div class="row">
            ${window.PREVIEW ? '' : `<button class="btn sm" data-act="exportJson">백업 저장</button>`}
            <span class="btn file-btn sm">백업 불러오기<input type="file" data-file="backup" accept=".json"></span>
            <button class="btn sm ghost" data-act="resetAll" style="color:var(--red)">전체 초기화</button>
          </div>
        </section>
      </div>
    </div>`;
  }

  function viewClassInfo() {
    const cloud = Store.kind === 'cloud';
    return `<section class="card classinfo">
      <div class="card-h"><div><h2>반코드</h2><p class="muted small">${cloud ? '학생은 이 코드로 입장해요. 같은 학년 선생님·공동 담임은 반코드와 선생님 비밀번호로 함께 관리할 수 있어요.' : '학생은 첫 화면에서 이 코드로 입장해요 (이 기기).'}</p></div>
        <div class="bigcode" title="반코드">${esc(curCode())}</div></div>
      <div class="row"><button class="btn sm" data-act="copyCode">반코드 복사</button>
        <input type="password" id="newKey" placeholder="새 선생님 비밀번호" autocomplete="new-password" style="width:170px"><button class="btn sm" data-act="changeKey">비밀번호 바꾸기</button></div>
      <div class="row" style="margin-top:8px"><input type="text" id="fromCode" inputmode="numeric" maxlength="6" placeholder="다른 반 반코드" style="width:150px"><button class="btn sm" data-act="importRolesFrom">그 반 역할 가져오기</button>
        <span class="small muted">학년 탭에서 역할 세트를 나눌 수도 있어요.</span></div>
    </section>`;
  }
  function seatInfo() {
    const st = T();
    const seats = st.roles.reduce((a, r) => a + (r.count | 0), 0);
    const n = st.students.length;
    let cls = 'ok', msg = '';
    if (!n) { cls = 'warn'; msg = '학생 명단을 넣으면 자리 수를 비교해 드려요.'; }
    else if (seats === n) msg = `딱 맞아요! 학생 ${n}명 · 자리 ${seats}개 → 모두 1인 1역`;
    else if (seats < n) { cls = 'bad'; msg = `자리가 ${n - seats}개 부족해요. 역할을 추가하거나 인원을 늘려 주세요. (학생 ${n}명 · 자리 ${seats}개)`; }
    else if (st.allowDouble) { cls = 'warn'; msg = `자리가 ${seats - n}개 남아요 → ${seats - n}명이 역할 2개를 맡아요. (1인 2역 희망 학생 먼저)`; }
    else { cls = 'warn'; msg = `자리가 ${seats - n}개 남아요. 1인 2역이 꺼져 있어서 일부 자리는 비워 둬요.`; }
    return { seats, n, cls, msg };
  }
  function updateSummary() {
    const si = $('#seatSummary');
    if (si) {
      const x = seatInfo();
      si.innerHTML = `<div class="summary"><div class="stat"><b>${T().roles.length}</b><span>역할</span></div><div class="stat"><b>${x.seats}</b><span>전체 자리</span></div><div class="stat"><b>${x.n}</b><span>학생</span></div></div><div class="note ${x.cls}">${x.msg}</div>`;
    }
    const ss = $('#stuSummary');
    if (ss) {
      const st = T().students;
      const m = st.filter((s) => s.gender === '남').length, f = st.filter((s) => s.gender === '여').length;
      const nog = st.length - m - f;
      ss.innerHTML = st.length ? `<div class="summary"><div class="stat"><b>${st.length}</b><span>전체</span></div><div class="stat"><b class="g-남">${m}</b><span>남</span></div><div class="stat"><b class="g-여">${f}</b><span>여</span></div></div>
        ${nog ? `<div class="note warn">성별이 비어 있는 학생이 ${nog}명 있어요. 또래상담 투표에 성별이 필요해요.</div>` : ''}
        ${Object.keys(T().prevByName || {}).length ? `<div class="note warn">직전 역할 파일에서 명단에 없는 이름 ${Object.keys(T().prevByName).length}명이 있어요: ${esc(Object.keys(T().prevByName).slice(0, 8).join(', '))}</div>` : ''}` : '';
    }
  }

  function setPath(obj, path, v) { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach((k) => (o = o[k])); o[ks[ks.length - 1]] = v; }

  // 입력 → 상태 반영
  $('#main').addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'tpin') { LS.set('roleonair:tpin', el.value); return; }
    if (el.dataset.k) {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.dataset.type === 'num') v = Math.max(0, parseInt(v, 10) || 0);
      setPath(T(), el.dataset.k, v);
      saveSettings(); updateSummary();
      if (['allowDouble'].includes(el.dataset.k)) updateSummary();
      return;
    }
    if (el.dataset.role) {
      const r = roleById(el.dataset.role); if (!r) return;
      const f = el.dataset.f;
      if (f === 'count') r.count = Math.max(0, parseInt(el.value, 10) || 0);
      else if (f === 'repeatable') r.repeatable = el.checked;
      else r[f] = el.value;
      saveSettings(); updateSummary(); return;
    }
    if (el.dataset.stu && el.dataset.f !== 'no') {
      const s = studentByNo(el.dataset.stu); if (!s) return;
      const f = el.dataset.f;
      if (f === 'prev') {
        const list = el.value.split(/[,，/]/).map(C.clean).filter(Boolean);
        if (list.length) T().prevRoles[s.no] = list; else delete T().prevRoles[s.no];
      } else s[f] = f === 'name' ? el.value.trim() : el.value;
      saveSettings(); updateSummary();
    }
  });
  $('#main').addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset.stu && el.dataset.f === 'no') {
      const s = studentByNo(el.dataset.stu); const nv = parseInt(el.value, 10);
      if (!nv || (studentByNo(nv) && nv !== +s.no)) { toast('번호가 비었거나 이미 있어요.'); el.value = s.no; return; }
      const old = s.no; s.no = nv;
      if (T().prevRoles[old]) { T().prevRoles[nv] = T().prevRoles[old]; delete T().prevRoles[old]; }
      T().students.sort((a, b) => a.no - b.no); saveSettings(); render(); return;
    }
    if (el.dataset.k === 'peer.candidates' || el.dataset.k === 'maxChoices') { render(); }
    if (el.dataset.file) {
      const f = el.files[0]; el.value = ''; if (!f) return;
      try {
        if (el.dataset.file === 'roster') await importRoster(f);
        if (el.dataset.file === 'prev') await importPrev(f);
        if (el.dataset.file === 'backup') await importBackup(f);
      } catch (err) { console.error(err); toast(err.message || '파일을 읽지 못했어요.', 4500); }
    }
  });

  /* ---------- 클릭 동작 ---------- */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act; const st = T();
    const A = {
      addRole() { st.roles.push({ id: C.uid(), name: '', desc: '', count: 1, repeatable: true }); saveSettings(); render(); setTimeout(() => { const ins = $$('input[data-f="name"][data-role]'); ins[ins.length - 1]?.focus(); }, 30); },
      delRole() { st.roles = st.roles.filter((r) => r.id !== b.dataset.id); saveSettings(); render(); },
      allRepeat() { st.roles.forEach((r) => (r.repeatable = b.dataset.v === '1')); saveSettings(); render(); },
      async exampleRoles() { if (await ask('지금 역할 목록을 예시 역할로 바꿀까요?')) { st.roles = defaults().roles; saveSettings(); render(); } },
      async clearRoles() { if (await ask('역할을 모두 지울까요?')) { st.roles = []; saveSettings(); render(); } },
      addStu() { const no = (st.students.reduce((a, s) => Math.max(a, s.no), 0) || 0) + 1; st.students.push({ no, name: '', gender: '' }); saveSettings(); render(); },
      delStu() { st.students = st.students.filter((s) => +s.no !== +b.dataset.no); delete st.prevRoles[b.dataset.no]; saveSettings(); render(); },
      async clearStu() { if (await ask('학생 명단을 모두 지울까요?')) { st.students = []; st.prevRoles = {}; saveSettings(); render(); } },
      rosterText() { openRosterText(); },
      genPins() { genPins(); },
      printPins() { printPins(); },
      exportJson() { exportJson(); },
      async resetAll() {
        if (!(await ask('설정·희망·투표·결과를 모두 지울까요? (먼저 백업을 권해요)'))) return;
        S.settings = defaults(); S.result = null; S.peerPick = null; S.pins = {};
        await Store.clearPrefs(); await Store.clearVotes(); S.prefs = {}; S.votes = {};
        Store.saveSettings(); await Store.saveResult(); render(); toast('초기화했어요.');
      },
      // 희망 받기
      togglePrefs() { st.prefsOpen = !st.prefsOpen; saveSettings(); render(); toast(st.prefsOpen ? '희망 받기를 시작했어요.' : '희망 받기를 마감했어요.'); },
      toggleVotes() { st.votesOpen = !st.votesOpen; saveSettings(); render(); toast(st.votesOpen ? '투표를 시작했어요.' : '투표를 마감했어요.'); },
      kioskPrefs() { openKiosk({ mode: 'prefs' }); },
      kioskVote() { openKiosk({ mode: 'vote' }); },
      viewPref() { openPrefDetail(+b.dataset.no); },
      async delPref() { await Store.deletePref(b.dataset.no); closeModal(); render(); toast('삭제했어요.'); },
      async clearPrefs() { if (await ask('제출된 희망을 모두 지울까요?')) { await Store.clearPrefs(); render(); } },
      copyLink() { navigator.clipboard?.writeText(studentLink()).then(() => toast('링크를 복사했어요.')); },
      // 또래상담
      enablePeer() { st.peer.enabled = true; saveSettings(); render(); },
      async clearVotes() { if (await ask('투표 결과를 모두 지울까요?')) { await Store.clearVotes(); S.tie = { male: [], female: [] }; render(); } },
      tieDraw() { const k = b.dataset.g; const t = C.tallyPeer(st, S.votes, S.prefs)[k]; S.tie[k] = C.shuffle(t.tied).slice(0, t.tiedNeed); render(); toast('동점자 중에서 추첨했어요.'); },
      tiePick() {
        const k = b.dataset.g, no = +b.dataset.no; const t = C.tallyPeer(st, S.votes, S.prefs)[k];
        const cur = S.tie[k];
        if (cur.includes(no)) S.tie[k] = cur.filter((x) => x !== no);
        else if (cur.length < t.tiedNeed) S.tie[k] = cur.concat(no);
        else toast(`${t.tiedNeed}명까지 고를 수 있어요.`);
        render();
      },
      async confirmPeer() {
        const t = C.tallyPeer(st, S.votes, S.prefs);
        const pick = {};
        for (const k of ['male', 'female']) {
          if (t[k].tied.length && S.tie[k].length !== t[k].tiedNeed) { toast('동점자를 먼저 정해 주세요.'); return; }
          pick[k] = t[k].picked.concat(S.tie[k]);
        }
        pick.at = Date.now(); S.peerPick = pick; await resultChanged(); render(); toast('또래상담자를 확정했어요.');
      },
      async unconfirmPeer() { S.peerPick = null; await resultChanged(); render(); },
      // 결과
      draw() { runDraw(); },
      async unassign() { editResult(+b.dataset.no, b.dataset.rid, false); },
      async togglePublish() { S.result.published = !S.result.published; await Store.saveResult(); if (Store.kind === 'cloud') await Store.setLive(S.result.published ? 'reveal' : 'idle'); render(); toast(S.result.published ? '학생 화면에 결과를 공개했어요.' : '공개를 취소했어요.'); },
      printResult() { printResult(); },
      exportXlsx() { exportXlsx(); },
      async resultToPrev() {
        if (!(await ask('이번 배정 결과를 각 학생의 ‘직전 역할’로 저장할까요? (다음 학기 뽑기에 쓰여요)'))) return;
        st.prevRoles = {};
        Object.entries(S.result.byStudent).forEach(([no, list]) => { if (list.length) st.prevRoles[no] = list.map((x) => (roleById(x.roleId) || {}).name).filter(Boolean); });
        saveSettings(); toast('직전 역할로 저장했어요. 설정 탭에서 확인할 수 있어요.');
      },
      closeModal() { closeModal(); },
      // 클라우드
      // 첫 화면 · 반
      async createClass() {
        const name = $('#nClass').value.trim() || '우리 반', key = $('#nKey').value;
        if (key.length < 6) { toast('선생님 비밀번호는 6자 이상으로 정해 주세요.'); return; }
        b.disabled = true;
        try { const code = await Store.create(name, key); await enterClass(code); toast(`반코드 ${code} — 학생들에게 알려 주세요!`, 6000); }
        catch (err) { b.disabled = false; toast('반을 만들지 못했어요: ' + err.message, 5000); }
      },
      async openRecent() {
        const code = b.dataset.code;
        try {
          if (await Store.needsKey(code)) {
            const key = await ask(`반코드 ${code} 선생님 비밀번호`, { input: true, text: true }); if (key == null) return;
            await Store.join(code, key);
          }
          await enterClass(code);
        } catch (err) { toast(err.message, 4000); }
      },
      async openByCode() {
        const code = $('#oCode').value.replace(/\D/g, ''), key = $('#oKey').value;
        if (!isCode(code)) { toast('반코드는 숫자 6자리예요.'); return; }
        try { await Store.join(code, key); await enterClass(code); } catch (err) { toast(err.message, 4000); }
      },
      async studentEnter() {
        const code = $('#sCode').value.replace(/\D/g, '');
        if (!isCode(code)) { toast('반코드 숫자 6자리를 넣어 주세요.'); return; }
        if (Store.kind === 'cloud') { location.href = `${location.pathname}?c=${code}`; return; }
        if (!Local.has(code)) { toast('이 기기에 없는 반코드예요.'); return; }
        await Store.open(code); renderTop(); openKiosk({ mode: 'both', fromLanding: true });
      },
      leaveClass() { Store.leave(); S.tab = 'settings'; render(); },
      async changeKey() {
        const k = $('#newKey').value; if (k.length < 6) { toast('6자 이상으로 정해 주세요.'); return; }
        try { await Store.changeKey(k); $('#newKey').value = ''; toast('선생님 비밀번호를 바꿨어요.'); } catch (err) { toast('바꾸지 못했어요: ' + err.message, 4000); }
      },
      async importRolesFrom() {
        const code = $('#fromCode').value.replace(/\D/g, '');
        if (!isCode(code)) { toast('반코드는 숫자 6자리예요.'); return; }
        try {
          const roles = await Store.readOtherRoles(code);
          if (!roles.length) { toast('그 반에는 역할이 없어요.'); return; }
          if (!(await ask(`반코드 ${code}의 역할 ${roles.length}개로 우리 반 역할을 바꿀까요?`))) return;
          st.roles = clone(roles).map((r) => ({ ...r, id: C.uid() })); saveSettings(); render(); toast('역할을 가져왔어요.');
        } catch (err) { toast(err.message, 4000); }
      },
      copyCode() { const c = curCode(); (navigator.clipboard ? navigator.clipboard.writeText(c) : Promise.reject()).then(() => toast('반코드를 복사했어요.'), () => toast(`반코드: ${c}`)); },
      // 학년
      async gradeCreate() { try { const c = await Grade.create($('#gName').value.trim()); toast(`학년코드 ${c} — 같은 학년 선생님께 알려 주세요!`, 6000); render(); } catch (err) { toast(err.message, 4000); } },
      async gradeJoin() {
        const c = $('#gCode').value.replace(/\D/g, ''); if (!isCode(c)) { toast('학년코드는 숫자 6자리예요.'); return; }
        try { await Grade.join(c); toast('학년 공간에 참여했어요.'); render(); } catch (err) { toast(err.message, 4000); }
      },
      async gradeLeave() { if (await ask('이 학년 공간에서 우리 반을 뺄까요?')) { await Grade.leave(); render(); } },
      async gradeRename() { const n = $('#gRename').value.trim(); if (!n) return; await Grade.rename(n); toast('학년 이름을 바꿨어요.'); render(); },
      async tplSave() {
        if (!st.roles.length) { toast('올릴 역할이 없어요.'); return; }
        const n = $('#tplName').value.trim() || `${st.className} 역할`;
        await Grade.saveTemplate(n, st.roles.map(({ name, desc, count, repeatable }) => ({ name, desc, count, repeatable })));
        toast('학년 역할 세트로 올렸어요.'); render();
      },
      async tplApply() {
        const t = (gradeCache.tpls || []).find((x) => x.id === b.dataset.id); if (!t) return;
        if (!(await ask(`‘${t.name}’ 역할 ${t.roles.length}개로 우리 반 역할을 바꿀까요? (지금 역할은 사라져요)`))) return;
        st.roles = clone(t.roles).map((r) => ({ ...r, id: C.uid() })); saveSettings(); toast('우리 반 역할을 바꿨어요. 설정 탭에서 인원을 확인하세요.', 4000); render();
      },
      async tplDel() { if (await ask('이 역할 세트를 지울까요?')) { await Grade.deleteTemplate(b.dataset.id); render(); } },
      boardDl() { openDownload((gradeCache.sorted || [])[+b.dataset.i]); },
      myDl() { openDownload(myBoard()); },
    };
    if (A[act]) { e.preventDefault(); await A[act](); }
  });
  $('#main').addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.addrole) { const rid = el.value; el.value = ''; if (rid) editResult(+el.dataset.addrole, rid, true); }
  });

  /* ---------- 명단 불러오기 ---------- */
  async function readWorkbookRows(file) {
    if (!window.XLSX) throw new Error('엑셀 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'array' });
    return wb.SheetNames.map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }));
  }
  async function importRoster(file) {
    const sheets = await readWorkbookRows(file);
    let best = [];
    sheets.forEach((rows) => { const r = C.parseRosterRows(rows); if (r.length > best.length) best = r; });
    if (!best.length) throw new Error('명단을 찾지 못했어요. ‘번호/성명/성별’ 제목 줄이 있는지 확인하거나 직접 입력을 써 주세요.');
    if (T().students.length && !(await ask(`지금 명단(${T().students.length}명)을 새 명단 ${best.length}명으로 바꿀까요?`))) return;
    T().students = best; resolvePrevByName(); saveSettings(); render();
    const nog = best.filter((s) => !s.gender).length;
    toast(`${best.length}명을 불러왔어요.${nog ? ` 성별이 없는 학생 ${nog}명은 직접 골라 주세요.` : ''}`, 4000);
  }
  function openRosterText() {
    const cur = T().students.map((s) => `${s.no}\t${s.name}\t${s.gender || ''}`).join('\n');
    openModal(`<h2>학생 명단 직접 입력</h2>
      <p class="muted small">한 줄에 한 명씩 <b>번호 이름 성별</b>. 엑셀에서 복사해 붙여 넣어도 돼요.<br>예) <code>1 김민수 남</code> · <code>2, 이서연, 여</code></p>
      <textarea id="rosterTa" style="min-height:300px" placeholder="1 김민수 남&#10;2 이서연 여">${esc(cur)}</textarea>
      <div class="foot"><button class="btn" data-act="closeModal">취소</button><button class="btn primary" id="rosterApply">적용</button></div>`);
    $('#rosterApply').onclick = () => {
      const list = C.parseRosterText($('#rosterTa').value);
      if (!list.length) { toast('이름을 찾지 못했어요.'); return; }
      T().students = list; resolvePrevByName(); saveSettings(); closeModal(); render(); toast(`${list.length}명을 저장했어요.`);
    };
  }
  function resolvePrevByName() {
    const st = T(); const pend = st.prevByName || {}; const left = {};
    Object.entries(pend).forEach(([name, roles]) => {
      const s = st.students.find((x) => x.name === name);
      if (s) st.prevRoles[s.no] = Array.from(new Set([...(st.prevRoles[s.no] || []), ...roles]));
      else left[name] = roles;
    });
    st.prevByName = left;
  }

  /* ---------- 직전 역할 파일 인식 ---------- */
  async function fileToRows(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const buf = new Uint8Array(await file.arrayBuffer());
    if (ext === 'hwp') return hwpToRows(buf);
    if (ext === 'hwpx') return hwpxToRows(buf);
    if (ext === 'pdf') return pdfToRows(buf);
    if (['xlsx', 'xls', 'csv', 'xlsm'].includes(ext)) return (await readWorkbookRows(file)).flat().map((r) => r.map(String));
    if (ext === 'txt') return C.textToRows(new TextDecoder('utf-8').decode(buf));
    throw new Error('지원하지 않는 형식이에요. (hwp, hwpx, pdf, xlsx, csv, txt)');
  }
  function hwpToRows(buf) {
    if (!window.XLSX || !XLSX.CFB || !window.pako) throw new Error('한글 파일 라이브러리를 불러오지 못했어요.');
    let cfb; try { cfb = XLSX.CFB.read(buf, { type: 'array' }); } catch (e) { throw new Error('한글(HWP 5.0) 파일이 아니거나 손상된 파일이에요. 한글에서 ‘다른 이름으로 저장 → HWPX’ 후 올려 보세요.'); }
    const idx = (re) => cfb.FullPaths.findIndex((p) => re.test(p));
    const hi = idx(/FileHeader$/i);
    if (hi < 0) throw new Error('한글 파일 정보를 찾지 못했어요.');
    const h = cfb.FileIndex[hi].content; const flags = h[36] | (h[37] << 8);
    if (flags & 2) throw new Error('암호가 걸린 한글 파일이에요. 암호를 해제하고 올려 주세요.');
    if (flags & 4) throw new Error('배포용 문서라 읽을 수 없어요. 한글에서 PDF로 저장해서 올려 주세요.');
    const compressed = !!(flags & 1);
    const secs = cfb.FullPaths.map((p, i) => ({ p, i, m: /BodyText\/Section(\d+)$/i.exec(p) })).filter((x) => x.m).sort((a, b) => a.m[1] - b.m[1]);
    const rows = [];
    secs.forEach((x) => {
      let u8 = new Uint8Array(cfb.FileIndex[x.i].content);
      if (compressed) u8 = pako.inflateRaw(u8);
      rows.push(...C.hwpRecordsToRows(u8));
    });
    return rows;
  }
  async function hwpxToRows(buf) {
    if (!window.JSZip) throw new Error('HWPX 라이브러리를 불러오지 못했어요.');
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).filter((n) => /contents\/section\d+\.xml$/i.test(n)).sort((a, b) => parseInt(a.match(/(\d+)\.xml/)[1]) - parseInt(b.match(/(\d+)\.xml/)[1]));
    const rows = [];
    for (const n of names) rows.push(...C.hwpxXmlToRows(await zip.file(n).async('string'), DOMParser));
    return rows;
  }
  async function pdfToRows(buf) {
    if (!window.pdfjsLib) throw new Error('PDF 라이브러리를 불러오지 못했어요.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const rows = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      rows.push(...C.pdfItemsToRows(tc.items));
    }
    return rows;
  }
  async function importPrev(file) {
    toast('파일을 읽는 중…');
    const rows = await fileToRows(file);
    if (!rows.length) throw new Error('글자를 찾지 못했어요. 스캔한 그림 PDF는 읽을 수 없어요.');
    const found = C.extractRolesFromRows(rows, T().students);
    if (!found.length) throw new Error('역할을 찾지 못했어요. 표 형태(역할 | 하는 일 | 이름)로 된 파일이면 더 잘 인식돼요.');
    openPrevReview(found, file.name);
  }
  function openPrevReview(found, fname) {
    const st = T(); const names = new Set(st.students.map((s) => s.name));
    const rows = found.map((r, i) => `<tr>
      <td><input type="checkbox" class="pv-on" data-i="${i}" ${r.holders.length || r.desc ? 'checked' : ''}></td>
      <td><input type="text" class="pv-name" data-i="${i}" value="${esc(r.name)}"></td>
      <td><input type="text" class="pv-desc" data-i="${i}" value="${esc(r.desc)}"></td>
      <td><input type="number" class="pv-cnt" data-i="${i}" value="${r.count}" min="1" max="9"></td>
      <td><input type="text" class="pv-hold" data-i="${i}" value="${esc(r.holders.join(', '))}">
        ${r.holders.some((h) => !names.has(h)) && st.students.length ? '<div class="small" style="color:#a1191b">명단에 없는 이름 포함</div>' : ''}</td></tr>`).join('');
    openModal(`<h2>직전 역할 인식 결과</h2>
      <p class="muted small">‘${esc(fname)}’에서 역할 ${found.length}개를 찾았어요. 잘못 인식된 줄은 체크를 해제하고, 이름·설명은 고칠 수 있어요.</p>
      <div class="tbl-wrap scroll" style="max-height:52vh"><table class="tbl"><thead><tr><th></th><th>역할</th><th>하는 일</th><th>인원</th><th>직전에 맡은 학생</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="field" style="margin-top:12px">
        <label class="switch"><input type="radio" name="pvmode" value="add" checked> 기존 역할 목록에 <b>추가</b> (같은 이름은 건너뜀)</label>
        <label class="switch"><input type="radio" name="pvmode" value="replace"> 역할 목록을 이 결과로 <b>바꾸기</b></label>
        ${sw('id="pvPrev"', true, '맡았던 학생을 ‘직전 역할’로 기록하기 (다시 불가 역할에 적용)')}
      </div>
      <div class="foot"><button class="btn" data-act="closeModal">취소</button><button class="btn primary" id="pvApply">적용하기</button></div>`);
    $('#pvApply').onclick = () => {
      const pick = found.map((r, i) => ({
        on: $(`.pv-on[data-i="${i}"]`).checked, name: C.clean($(`.pv-name[data-i="${i}"]`).value), desc: C.clean($(`.pv-desc[data-i="${i}"]`).value),
        count: Math.max(1, parseInt($(`.pv-cnt[data-i="${i}"]`).value, 10) || 1), holders: $(`.pv-hold[data-i="${i}"]`).value.split(/[,，]/).map(C.clean).filter(Boolean),
      })).filter((r) => r.on && r.name);
      const mode = $('input[name="pvmode"]:checked').value;
      if (mode === 'replace') st.roles = [];
      let added = 0;
      pick.forEach((r) => {
        const ex = st.roles.find((x) => C.normRole(x.name) === C.normRole(r.name));
        if (ex) { if (!ex.desc) ex.desc = r.desc; return; }
        st.roles.push({ id: C.uid(), name: r.name, desc: r.desc, count: r.count, repeatable: true }); added++;
      });
      let linked = 0;
      if ($('#pvPrev').checked) {
        st.prevRoles = {}; st.prevByName = {};
        pick.forEach((r) => r.holders.forEach((h) => {
          const name = h.replace(/^\d+\s*/, '').replace(/\s/g, '');
          const s = st.students.find((x) => x.name === name);
          if (s) { (st.prevRoles[s.no] = st.prevRoles[s.no] || []).push(r.name); linked++; }
          else (st.prevByName[name] = st.prevByName[name] || []).push(r.name);
        }));
      }
      saveSettings(); closeModal(); render();
      toast(`역할 ${added}개 추가 · 직전 역할 ${linked}명 연결`, 4000);
    };
  }

  /* ---------- 확인코드 / 백업 / 인쇄 ---------- */
  async function genPins() {
    const st = T();
    if (!st.students.length) { toast('학생 명단을 먼저 넣어 주세요.'); return; }
    const redo = Object.keys(S.pins).length && await ask('이미 있는 코드도 새로 만들까요? (취소 = 없는 학생만 만들기)');
    st.students.forEach((s) => { if (redo || !S.pins[s.no]) S.pins[s.no] = C.makePin(); });
    st.usePin = true; saveSettings(); await Store.savePins(); render(); toast('확인코드를 만들었어요. 카드를 인쇄해 나눠 주세요.');
  }
  function doPrint(html) {
    $('#print').innerHTML = html; document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); setTimeout(() => window.print(), 50);
  }
  function printPins() {
    const cards = T().students.map((s) => `<div class="pincard">${s.no}번 ${esc(s.name)}<b>${esc(S.pins[s.no] || '----')}</b><small>1인1역 확인코드</small></div>`).join('');
    doPrint(`<h1>${esc(T().className)} · 학생 확인코드</h1><div class="pincards">${cards}</div>`);
  }
  function exportJson() {
    const data = { app: 'roleonair', v: 1, at: new Date().toISOString(), settings: S.settings, prefs: S.prefs, votes: S.votes, result: S.result, peerPick: S.peerPick, pins: S.pins };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `1인1역_${T().className}_${new Date().toISOString().slice(0, 10)}.json`; a.click();
  }
  async function importBackup(file) {
    const d = JSON.parse(await file.text());
    if (d.app !== 'roleonair') throw new Error('1인1역 온에어 백업 파일이 아니에요.');
    if (!(await ask('백업으로 덮어쓸까요?'))) return;
    S.settings = { ...defaults(), ...d.settings }; S.result = d.result || null; S.peerPick = d.peerPick || null; S.pins = d.pins || {};
    if (Store.kind === 'local') { S.prefs = d.prefs || {}; S.votes = d.votes || {}; Store.saveAll(); }
    else {
      for (const [no, p] of Object.entries(d.prefs || {})) await Store.savePref(no, p);
      for (const [no, v] of Object.entries(d.votes || {})) await Store.saveVote(no, v);
      Store.saveSettings(); await Store.saveResult(); await Store.savePins();
    }
    render(); toast('백업을 불러왔어요.');
  }

  /* ---------- 모달 ---------- */
  function openModal(html) { const m = $('#modal'); m.innerHTML = `<div class="box">${html}</div>`; m.hidden = false; }
  function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  /* =========================================================
   * ② 희망 받기
   * ========================================================= */
  function studentLink() { return `${location.origin}${location.pathname}?c=${Cloud.code}`; }
  function viewPrefs() {
    const st = T();
    const done = st.students.filter((s) => S.prefs[s.no]);
    const firstCnt = {}; Object.values(S.prefs).forEach((p) => { const r = (p.choices || [])[0]; if (r) firstCnt[r] = (firstCnt[r] || 0) + 1; });
    const maxF = Math.max(1, ...Object.values(firstCnt));
    const bars = st.roles.map((r) => ({ r, n: firstCnt[r.id] || 0 })).sort((a, b) => b.n - a.n).filter((x) => x.n).slice(0, 12)
      .map((x) => `<div class="bar"><span>${esc(x.r.name)} <span class="muted small">(${x.r.count}자리)</span></span><div class="t"><i style="width:${(x.n / maxF) * 100}%"></i></div><b>${x.n}</b></div>`).join('');
    const grid = st.students.map((s) => {
      const p = S.prefs[s.no];
      return `<button class="sbox ${p ? 'done' : ''}" data-act="viewPref" data-no="${s.no}">
        <div class="n">${s.no}번</div><div class="nm">${esc(s.name)}</div>
        <div class="tag">${p ? `✓ ${(roleById((p.choices || [])[0]) || {}).name || ''}${p.double ? ' · 2역OK' : ''}` : '<span class="muted">미제출</span>'}</div></button>`;
    }).join('');
    const cloud = Store.kind === 'cloud';
    return `
      <div class="hero">
        <div><div class="small" style="opacity:.7">STEP 2</div><h2>희망 역할 받기</h2>
          <div style="opacity:.85">학생마다 1~${st.maxChoices}지망을 골라요. 제출 ${done.length} / ${st.students.length}명</div></div>
        <div class="row">
          <button class="btn big ${st.prefsOpen ? 'red' : 'mint'}" data-act="togglePrefs">${st.prefsOpen ? '■ 마감하기' : '▶ 희망 받기 시작'}</button>
          <button class="btn big" data-act="kioskPrefs">이 기기에서 학생 입력</button>
        </div>
      </div>
      ${!st.students.length || !st.roles.length ? `<div class="note bad">설정에서 학생 명단과 역할을 먼저 만들어 주세요.</div>` : ''}
      <div class="grid2">
        <section class="card">
          <div class="card-h"><div><h3>제출 현황</h3><p class="muted small">이름을 누르면 희망 순서를 보고 지울 수 있어요.</p></div>
            <button class="btn sm ghost" data-act="clearPrefs">모두 지우기</button></div>
          <div class="sgrid">${grid || '<span class="muted">학생이 없어요.</span>'}</div>
        </section>
        <div>
          ${cloud ? `<section class="card"><div class="card-h"><div><h3>학생 접속</h3><p class="muted small">학생들이 자기 기기에서 이 주소로 들어와요.${st.usePin ? ' 확인코드가 필요해요.' : ''}</p></div></div>
            <div class="row" style="align-items:flex-start;gap:16px"><div class="qr" id="qr"></div>
            <div style="flex:1;min-width:200px"><div class="lbl">반코드 (첫 화면에서 입력)</div><div class="display bigcode">${esc(Cloud.code)}</div>
            <div class="link-box">${esc(studentLink())}</div><button class="btn sm" style="margin-top:8px" data-act="copyLink">링크 복사</button></div></div>
            ${!st.prefsOpen ? '<div class="note warn">‘희망 받기 시작’을 눌러야 학생들이 제출할 수 있어요.</div>' : ''}</section>`
          : `<section class="card"><h3>교실 한 대로 진행하기</h3><p class="small muted">‘이 기기에서 학생 입력’을 누르거나, 첫 화면 ‘학생’ 칸에 반코드 <b>${esc(curCode())}</b>를 넣으면 학생 화면이 열려요. 학생이 차례로 번호를 누르고 희망을 고른 뒤 제출해요. 클라우드 모드(★ Firebase)면 학생 각자 기기에서 반코드로 들어와요.</p></section>`}
          <section class="card"><h3>1지망 인기 역할</h3><p class="small muted">자리보다 1지망이 많으면 추첨이 돼요.</p>
            <div class="bars">${bars || '<span class="muted small">아직 제출이 없어요.</span>'}</div></section>
        </div>
      </div>`;
  }
  function drawQR() {
    const el = $('#qr'); if (!el || !window.QRCode) return;
    el.innerHTML = ''; new QRCode(el, { text: studentLink(), width: 150, height: 150 });
  }
  async function openPrefDetail(no) {
    const s = studentByNo(no); const p = S.prefs[no];
    if (!p) { if (await ask(`${s.name} 학생의 희망을 지금 입력할까요?`)) openKiosk({ mode: 'prefs', no }); return; }
    const list = (p.choices || []).map((id, i) => `<li><b>${i + 1}지망</b> ${esc((roleById(id) || { name: '(삭제된 역할)' }).name)}</li>`).join('');
    openModal(`<h2>${s.no}번 ${esc(s.name)}</h2><ol style="list-style:none;padding:0;line-height:2">${list}</ol>
      <p class="small muted">${p.double ? '✓ 역할 2개도 괜찮아요' : ''} ${p.peerVolunteer ? ' · ✓ 또래상담 지원' : ''}</p>
      <div class="foot"><button class="btn" data-act="delPref" data-no="${no}" style="color:var(--red)">이 희망 지우기</button>
      <button class="btn" id="editPref">다시 입력</button><button class="btn primary" data-act="closeModal">닫기</button></div>`);
    $('#editPref').onclick = () => { closeModal(); openKiosk({ mode: 'prefs', no }); };
  }

  /* =========================================================
   * ③ 또래상담 투표
   * ========================================================= */
  function viewPeer() {
    const st = T(); const p = st.peer;
    if (!p.enabled) return `<section class="card"><h2>또래상담자 투표가 꺼져 있어요</h2><button class="btn primary" data-act="enablePeer">켜기</button></section>`;
    const t = C.tallyPeer(st, S.votes, S.prefs);
    const box = (k, g, cls) => {
      const r = t[k]; const max = Math.max(1, ...r.ranking.map((x) => x.votes));
      const need = p[k];
      const pickedFinal = S.peerPick ? S.peerPick[k] : null;
      const list = r.ranking.map((x, i) => {
        const isPick = pickedFinal ? pickedFinal.includes(x.no) : (r.picked.includes(x.no) || S.tie[k].includes(x.no));
        const isTie = r.tied.includes(x.no);
        return `<div class="bar ${cls} ${isPick ? 'pick' : ''}"><span>${isPick ? '<i class="pickdot"></i>' : ''}${x.no}. ${esc(nameOf(x.no))}${isTie && !pickedFinal ? ` <button class="btn sm" data-act="tiePick" data-g="${k}" data-no="${x.no}" style="padding:1px 6px">${S.tie[k].includes(x.no) ? '✓' : '선택'}</button>` : ''}</span>
          <div class="t"><i style="width:${(x.votes / max) * 100}%"></i></div><b>${x.votes}</b></div>`;
      }).join('');
      return `<section class="card">
        <div class="card-h"><div><h3 class="g-${g}">${g}학생 ${need}명</h3><p class="small muted">후보 ${r.ranking.length}명</p></div>
        ${r.tied.length && !pickedFinal ? `<button class="btn sm red" data-act="tieDraw" data-g="${k}">동점자 추첨</button>` : ''}</div>
        ${r.tied.length && !pickedFinal ? `<div class="note warn">${r.ranking.find((x) => r.tied.includes(x.no)).votes}표 동점 ${r.tied.length}명 중 ${r.tiedNeed}명을 정해야 해요. ‘선택’으로 직접 고르거나 추첨하세요.</div>` : ''}
        <div class="bars" style="margin-top:10px">${list || '<span class="muted small">후보가 없어요. 학생 성별을 확인해 주세요.</span>'}</div></section>`;
    };
    const voted = Object.keys(S.votes).length;
    return `
      <div class="hero">
        <div><div class="small" style="opacity:.7">STEP 3 · 1인1역과 별도</div><h2>${esc(p.title)} 투표</h2>
          <div style="opacity:.85">남 ${p.male}명 · 여 ${p.female}명 · 한 사람이 성별마다 ${p.votesPerGender}명씩 · 투표 ${voted} / ${st.students.length}명</div></div>
        <div class="row">
          <button class="btn big ${st.votesOpen ? 'red' : 'mint'}" data-act="toggleVotes">${st.votesOpen ? '■ 투표 마감' : '▶ 투표 시작'}</button>
          <button class="btn big" data-act="kioskVote">이 기기에서 투표</button>
        </div>
      </div>
      ${p.candidates === 'volunteer' ? `<div class="note warn" style="margin-bottom:14px">후보: 희망 받기에서 ‘또래상담 하고 싶어요’를 고른 학생만 (${(st.peerCandidates || []).length}명). 희망 받기를 먼저 진행하세요.</div>` : ''}
      ${S.peerPick ? `<div class="note ok" style="margin-bottom:14px">✓ 확정됨: 남 ${S.peerPick.male.map(nameOf).join(', ') || '-'} / 여 ${S.peerPick.female.map(nameOf).join(', ') || '-'}
        <button class="btn sm" data-act="unconfirmPeer" style="margin-left:8px">확정 취소</button></div>` : ''}
      <div class="peer-box">${box('male', '남', 'boy')}${box('female', '여', 'girl')}</div>
      <div class="row" style="margin-top:4px">
        ${!S.peerPick ? `<button class="btn primary big" data-act="confirmPeer">또래상담자 확정</button>` : ''}
        <button class="btn ghost" data-act="clearVotes">투표 모두 지우기</button>
        <span class="small muted">누가 누구에게 투표했는지는 학생에게 보이지 않아요.</span>
      </div>`;
  }

  /* =========================================================
   * ④ 역할 뽑기 · 결과
   * ========================================================= */
  function recompute(res) {
    const st = T(); const byRole = {}; st.roles.forEach((r) => (byRole[r.id] = []));
    Object.entries(res.byStudent).forEach(([no, list]) => list.forEach((x) => { if (byRole[x.roleId]) byRole[x.roleId].push(+no); }));
    Object.values(byRole).forEach((l) => l.sort((a, b) => a - b));
    res.byRole = byRole;
    res.unassigned = st.students.filter((s) => !(res.byStudent[s.no] || []).length).map((s) => s.no);
    res.unfilled = st.roles.filter((r) => byRole[r.id].length < r.count).map((r) => ({ roleId: r.id, left: r.count - byRole[r.id].length }));
    res.stats = C.statsOf(res.byStudent, st.maxChoices);
  }
  function editResult(no, rid, add) {
    const res = S.result; if (!res) return;
    const list = res.byStudent[no] = res.byStudent[no] || [];
    if (add) {
      if (list.some((x) => x.roleId === rid)) return;
      const p = S.prefs[no]; list.push({ roleId: rid, rank: p && p.choices ? p.choices.indexOf(rid) : -1, manual: true });
      const r = roleById(rid); if (res.byRole[rid] && res.byRole[rid].length >= r.count) toast(`${r.name}: 정한 인원(${r.count}명)보다 많아졌어요.`);
    } else res.byStudent[no] = list.filter((x) => x.roleId !== rid);
    recompute(res); resultChanged(); render();
  }
  function rankBadge(x) {
    if (x.manual) return '<span class="rk">수정</span>';
    if (x.rank >= 0) return `<span class="rk r${Math.min(x.rank, 2)}">${x.rank + 1}지망</span>`;
    return '<span class="rk">추첨</span>';
  }
  function viewResult() {
    const st = T(); const res = S.result; const si = seatInfo();
    const notSub = st.students.filter((s) => !S.prefs[s.no]).length;
    const warn = [];
    if (si.seats < si.n) warn.push(`<div class="note bad">${si.msg}</div>`);
    if (notSub) warn.push(`<div class="note warn">희망을 내지 않은 학생 ${notSub}명은 남은 역할에서 추첨돼요.</div>`);
    let body = '';
    if (res && res.byStudent) {
      const cards = st.roles.map((r, i) => {
        const who = (res.byRole[r.id] || []).map((no) => {
          const x = (res.byStudent[no] || []).find((y) => y.roleId === r.id) || {};
          return `<span class="chip">${esc(nameOf(no))} ${rankBadge(x)}</span>`;
        }).join('');
        const left = r.count - (res.byRole[r.id] || []).length;
        return `<div class="rcard" style="animation-delay:${Math.min(i * 45, 1500)}ms"><h4><span>${esc(r.name)}</span><span class="small muted">${r.count}명</span></h4>
          <div class="d">${esc(r.desc)}</div><div class="who">${who}${left > 0 ? `<span class="chip empty">빈자리 ${left}</span>` : ''}</div></div>`;
      }).join('');
      const opt = st.roles.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
      const rows = st.students.map((s) => {
        const list = res.byStudent[s.no] || [];
        const peer = S.peerPick && (S.peerPick.male.includes(+s.no) || S.peerPick.female.includes(+s.no));
        return `<tr><td>${s.no}</td><td><b>${esc(s.name)}</b>${peer ? ' ' : ''}</td>
          <td><div class="who">${list.map((x) => `<span class="chip">${esc((roleById(x.roleId) || {}).name)} ${rankBadge(x)}<button data-act="unassign" data-no="${s.no}" data-rid="${x.roleId}" title="빼기">×</button></span>`).join('') || '<span class="chip empty">없음</span>'}</div></td>
          <td><select data-addrole="${s.no}" style="padding:4px 6px"><option value="">+ 역할</option>${opt}</select></td></tr>`;
      }).join('');
      const s = res.stats || { ranks: [], other: 0 };
      const statHtml = s.ranks.map((n, i) => n ? `<div class="stat"><b>${n}</b><span>${i + 1}지망</span></div>` : '').join('') + (s.other ? `<div class="stat"><b>${s.other}</b><span>추첨/기타</span></div>` : '');
      const dbl = Object.values(res.byStudent).filter((l) => l.length > 1).length;
      body = `
        <section class="card">
          <div class="card-h"><div><h2>배정 결과</h2><p class="small muted">첫 번째 역할 기준 만족도${dbl ? ` · 1인 2역 ${dbl}명` : ''}</p></div>
            <div class="row">
              ${Store.kind === 'cloud' ? `<button class="btn ${res.published ? 'red' : 'mint'}" data-act="togglePublish">${res.published ? '발표 내리기' : '학생 화면에 발표'}</button>` : ''}
              <button class="btn primary" data-act="myDl">PDF·이미지</button>
              ${window.PREVIEW ? '' : `<button class="btn" data-act="printResult">인쇄</button><button class="btn" data-act="exportXlsx">엑셀 저장</button>`}
              <button class="btn" data-act="resultToPrev" title="다음 뽑기 때 직전 역할로 쓰기">직전 역할로 저장</button></div></div>
          <div class="summary" style="margin-top:0">${statHtml}</div>
          ${res.unassigned.length ? `<div class="note bad">역할이 없는 학생: ${res.unassigned.map(nameOf).join(', ')} — 아래 표에서 직접 넣어 주세요.</div>` : ''}
          ${res.unfilled.length ? `<div class="note warn">빈자리: ${res.unfilled.map((u) => `${esc((roleById(u.roleId) || {}).name)} ${u.left}`).join(', ')}</div>` : ''}
        </section>
        ${S.peerPick ? `<section class="card crown"><h3>${esc(st.peer.title)}</h3><p class="small muted" style="margin:4px 0 10px">${esc(st.peer.desc)}</p>
          <div class="who">${S.peerPick.male.map((n) => `<span class="chip"><span class="g-남">남</span> ${esc(nameOf(n))}</span>`).join('')}${S.peerPick.female.map((n) => `<span class="chip"><span class="g-여">여</span> ${esc(nameOf(n))}</span>`).join('')}</div></section>` : ''}
        <div class="rcards" style="margin-bottom:18px">${cards}</div>
        <section class="card"><div class="card-h"><div><h3>학생별 보기 · 직접 고치기</h3><p class="small muted">× 로 빼고, ‘+ 역할’로 넣어요. 바뀐 내용은 바로 저장돼요.</p></div></div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>번호</th><th>이름</th><th>역할</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }
    return `
      <div class="hero">
        <div><div class="small" style="opacity:.7">STEP 4</div><h2>역할 뽑기</h2>
          <div style="opacity:.85">학생 ${si.n}명 · 자리 ${si.seats}개 · 희망 제출 ${si.n - notSub}명</div></div>
        <div class="hero-act"><button class="btn big red" data-act="draw" ${!si.n || !st.roles.length ? 'disabled' : ''}>${res ? '다시 뽑기' : '역할 뽑기 시작!'}</button>
          ${Store.kind === 'cloud' ? `<div class="on-dark">${sw('data-k="liveShow" data-type="bool"', st.liveShow !== false, '학생 화면에 생방송')}</div>` : ''}</div>
      </div>
      ${warn.join('')}
      ${body || `<section class="card"><p class="muted">아직 뽑기 전이에요. 희망을 받은 뒤 ‘역할 뽑기 시작’을 눌러 주세요.</p></section>`}`;
  }

  async function runDraw() {
    const st = T();
    if (S.result && !(await ask('다시 뽑으면 지금 결과(직접 고친 내용 포함)가 바뀌어요. 계속할까요?'))) return;
    if (st.prefsOpen && !(await ask('아직 희망 받기가 열려 있어요. 마감하고 뽑을까요?'))) return;
    if (st.prefsOpen) { st.prefsOpen = false; saveSettings(); }
    const res = C.assignRoles(st, S.prefs);
    const live = Store.kind === 'cloud' && st.liveShow !== false;
    if (live) await Store.setLive('drawing').catch((e) => toast('생방송 신호를 보내지 못했어요: ' + e.message));
    // 연출
    const d = $('#drum'); d.hidden = false;
    d.innerHTML = `<span class="lamp"></span><div class="lbl2">${live ? '생방송 · ' : ''}${esc(st.className)} 1인1역 뽑기</div><div class="roll" id="roll"></div><div class="sub" id="rollSub"></div>
      <button class="btn" style="margin-top:28px" id="skipDrum">건너뛰기 ▶</button>`;
    let skip = false; $('#skipDrum').onclick = () => (skip = true);
    const names = st.students.map((s) => s.name); const roles = st.roles.map((r) => r.name);
    for (let i = 0; i < 22 && !skip; i++) {
      $('#roll').textContent = roles[Math.floor(Math.random() * roles.length)] || '';
      $('#rollSub').textContent = names[Math.floor(Math.random() * names.length)] || '';
      await sleep(60 + i * 6);
    }
    const order = C.shuffle(st.roles).slice(0, 6);
    for (const r of order) {
      if (skip) break;
      $('#roll').textContent = r.name;
      $('#rollSub').textContent = '두구두구…'; await sleep(450);
      if (skip) break;
      $('#rollSub').textContent = '→ ' + (res.byRole[r.id] || []).map(nameOf).join(', ');
      await sleep(700);
    }
    d.hidden = true;
    S.result = { ...res, published: live }; recompute(S.result);
    await Store.saveResult(); if (live) await Store.setLive('reveal').catch(() => {});
    S.tab = 'result'; render();
    toast(live ? '학생 화면에 결과가 발표됐어요! 고치면 학생 화면도 바뀌어요.' : '배정이 끝났어요! 아래에서 직접 고칠 수도 있어요.', 4000);
  }

  function printResult() {
    const st = T(); const res = S.result;
    const rows = st.roles.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.desc)}</td><td>${(res.byRole[r.id] || []).map(nameOf).join(', ')}</td></tr>`).join('');
    const peer = S.peerPick ? `<h1 style="margin-top:18px;font-size:20px">${esc(st.peer.title)}</h1><p>남: ${S.peerPick.male.map(nameOf).join(', ')} / 여: ${S.peerPick.female.map(nameOf).join(', ')}</p>` : '';
    doPrint(`<h1>${esc(st.className)} 1인1역</h1><table><thead><tr><th style="width:18%">역할</th><th>하는 일</th><th style="width:28%">맡은 사람</th></tr></thead><tbody>${rows}</tbody></table>${peer}`);
  }
  function exportXlsx() {
    if (!window.XLSX) { toast('엑셀 라이브러리를 불러오지 못했어요.'); return; }
    const st = T(); const res = S.result;
    const peerSet = new Set(S.peerPick ? [...S.peerPick.male, ...S.peerPick.female] : []);
    const a1 = [['번호', '이름', '성별', '역할1', '지망', '역할2', '지망', '또래상담']];
    st.students.forEach((s) => {
      const l = res.byStudent[s.no] || [];
      const rk = (x) => (x ? (x.rank >= 0 ? `${x.rank + 1}지망` : (x.manual ? '수정' : '추첨')) : '');
      a1.push([s.no, s.name, s.gender, (roleById((l[0] || {}).roleId) || {}).name || '', rk(l[0]), (roleById((l[1] || {}).roleId) || {}).name || '', rk(l[1]), peerSet.has(+s.no) ? 'O' : '']);
    });
    const a2 = [['역할', '하는 일', '인원', '맡은 사람']].concat(st.roles.map((r) => [r.name, r.desc, r.count, (res.byRole[r.id] || []).map(nameOf).join(', ')]));
    const wb = XLSX.utils.book_new();
    const w1 = XLSX.utils.aoa_to_sheet(a1); w1['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 6 }, { wch: 16 }, { wch: 7 }, { wch: 16 }, { wch: 7 }, { wch: 9 }];
    const w2 = XLSX.utils.aoa_to_sheet(a2); w2['!cols'] = [{ wch: 16 }, { wch: 40 }, { wch: 6 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, w1, '학생별'); XLSX.utils.book_append_sheet(wb, w2, '역할별');
    XLSX.writeFile(wb, `1인1역_${st.className}.xlsx`);
  }

  /* =========================================================
   * ⑤ 학년 — 여러 선생님이 역할 세트·최종 역할표 공유
   * ========================================================= */
  const fmtDate = (t) => { const d = new Date(t || Date.now()); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`; };
  let gradeCache = { boards: [] };
  function viewGradeShell() {
    return `<div class="hero"><div><div class="small" style="opacity:.7">학년 공간</div><h2>같은 학년 선생님과 함께</h2>
      <div style="opacity:.85">역할 세트를 나누고, 반마다 확정된 역할표를 한눈에 봐요.</div></div></div>
      <div id="gradeBody"><section class="card"><p class="muted">불러오는 중…</p></section></div>`;
  }
  async function loadGrade() {
    const box = $('#gradeBody'); if (!box) return;
    try {
      const g = await Grade.get();
      if (!g) { box.innerHTML = viewGradeJoin(); return; }
      const [tpls, boards] = await Promise.all([Grade.listTemplates(), Grade.listBoards()]);
      gradeCache = { g, tpls, boards };
      if ($('#gradeBody')) $('#gradeBody').innerHTML = viewGrade(g, tpls, boards);
    } catch (e) { box.innerHTML = `<div class="note bad">학년 정보를 불러오지 못했어요: ${esc(e.message)}</div>`; }
  }
  function viewGradeJoin() {
    return `<div class="grid2">
      <section class="card"><h3>학년 공간 만들기</h3><p class="small muted">학년 대표 선생님이 한 번 만들고, 나온 <b>학년코드</b>를 다른 선생님께 알려 주세요.</p>
        <div class="row"><input type="text" id="gName" placeholder="예: 2026 5학년" style="flex:1"><button class="btn primary" data-act="gradeCreate">만들기</button></div></section>
      <section class="card"><h3>학년코드로 참여</h3><p class="small muted">다른 선생님이 알려 준 학년코드 6자리를 넣으면 우리 반이 그 학년에 들어가요.</p>
        <div class="row"><input type="text" id="gCode" inputmode="numeric" maxlength="6" placeholder="학년코드 6자리" style="width:160px"><button class="btn primary" data-act="gradeJoin">참여</button></div></section>
    </div>`;
  }
  function viewGrade(g, tpls, boards) {
    const cloud = Store.kind === 'cloud';
    const members = (g.members || []).map((m) => `<span class="chip">${esc(m.className || '')} <code class="small">${esc(m.code)}</code></span>`).join('');
    const tplRows = tpls.map((t) => `<div class="tpl"><div><b>${esc(t.name)}</b><div class="small muted">${esc(t.byName || '')} · 역할 ${(t.roles || []).length}개 · ${fmtDate(t.at)}</div>
        <div class="small muted tpl-names">${esc((t.roles || []).map((r) => r.name).join(' · '))}</div></div>
      <div class="row"><button class="btn sm" data-act="tplApply" data-id="${esc(t.id)}">우리 반에 적용</button>${t.mine ? `<button class="btn sm ghost" data-act="tplDel" data-id="${esc(t.id)}">삭제</button>` : ''}</div></div>`).join('');
    const boardCards = boards.sort((a, b) => String(a.className).localeCompare(String(b.className), 'ko')).map((b, i) => `
      <article class="bcard ${b.mine ? 'mine' : ''}">
        <div class="bcard-h"><div><h3>${esc(b.className)}${b.mine ? ' <span class="pill local">우리 반</span>' : ''}</h3><div class="small muted">${fmtDate(b.at)} 확정 · 역할 ${b.roles.length}개 · 학생 ${b.students.length}명</div></div>
          <button class="btn sm" data-act="boardDl" data-i="${i}">이미지·PDF</button></div>
        <div class="bmini">${b.roles.slice(0, 40).map((r) => `<div><b>${esc(r.name)}</b><span>${esc(r.names.join(', ') || '-')}</span></div>`).join('')}</div>
        ${b.peer ? `<div class="small" style="margin-top:8px">${esc(b.peer.title)}: ${esc([...b.peer.male, ...b.peer.female].join(', '))}</div>` : ''}
      </article>`).join('');
    gradeCache.sorted = boards;
    return `
      <section class="card">
        <div class="card-h"><div><h3>${esc(g.name)}</h3>
          <p class="small muted">${cloud ? `학년코드 <b class="mono">${esc(g.id)}</b> — 같은 학년 선생님께 알려 주면 각자 반에서 ‘학년코드로 참여’로 들어와요.` : '이 기기에 만든 반들이 한 학년으로 묶여요. 여러 기기에서 함께 쓰려면 클라우드 모드(★ Firebase)를 연결하세요.'}</p></div>
          <div class="row"><input type="text" id="gRename" value="${esc(g.name)}" style="width:180px"><button class="btn sm" data-act="gradeRename">이름 바꾸기</button>
          ${cloud ? '<button class="btn sm ghost" data-act="gradeLeave">학년에서 나가기</button>' : ''}</div></div>
        <div class="who">${members || '<span class="muted small">참여한 반이 없어요.</span>'}</div>
        ${cloud ? `<div class="field" style="margin-top:12px">${sw('data-k="shareBoard" data-type="bool"', T().shareBoard !== false, '우리 반 최종 역할표를 학년에 공유 (뽑기·수정할 때마다 갱신)')}</div>` : ''}
      </section>
      <section class="card">
        <div class="card-h"><div><h3>학년 역할 세트</h3><p class="small muted">한 선생님이 만든 역할 목록을 다른 반이 그대로 가져다 써요. 인원은 반마다 고치면 돼요.</p></div>
          <div class="row"><input type="text" id="tplName" placeholder="예: 5학년 2학기 기본" style="width:200px"><button class="btn sm primary" data-act="tplSave">우리 반 역할 올리기 (${T().roles.length}개)</button></div></div>
        <div class="tpls">${tplRows || '<span class="muted small">아직 올라온 역할 세트가 없어요.</span>'}</div>
      </section>
      <section>
        <div class="card-h" style="margin:6px 2px 10px"><div><h2>반별 최종 역할표</h2><p class="small muted">뽑기를 마친 반이 여기에 나타나요.</p></div></div>
        <div class="bgrid">${boardCards || '<section class="card"><span class="muted">아직 뽑기를 마친 반이 없어요.</span></section>'}</div>
      </section>`;
  }

  /* =========================================================
   * 최종 역할표 PDF · 이미지 내려받기
   * ========================================================= */
  function sheetHTML(b, kind) {
    const date = fmtDate(b.at);
    const head = `<header class="sh-head"><div><div class="sh-eye"><span class="sh-lamp"></span>1인1역 ON AIR</div>
      <h1>${esc(b.className)} 1인1역</h1></div><div class="sh-date">${date}</div></header>`;
    let body = '';
    if (kind === 'student') {
      const half = Math.ceil(b.students.length / 2);
      const col = (list) => `<table class="sh-t"><thead><tr><th style="width:44px">번호</th><th style="width:84px">이름</th><th>역할</th></tr></thead><tbody>
        ${list.map((s) => `<tr><td class="num">${s.no}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.roles.join(', ') || '-')}${s.peer ? ' <span class="sh-peer">또래상담</span>' : ''}</td></tr>`).join('')}</tbody></table>`;
      body = `<div class="sh-cols">${col(b.students.slice(0, half))}${col(b.students.slice(half))}</div>`;
    } else {
      body = `<table class="sh-t"><thead><tr><th style="width:150px">역할</th><th>하는 일</th><th style="width:190px">맡은 사람</th></tr></thead><tbody>
        ${b.roles.map((r) => `<tr><td class="rn">${esc(r.name)}</td><td class="ds">${esc(r.desc)}</td><td class="sh-who">${esc(r.names.join(', ') || '-')}</td></tr>`).join('')}</tbody></table>`;
    }
    const peer = b.peer ? `<div class="sh-peerbox"><b>${esc(b.peer.title)}</b><span>남 ${esc(b.peer.male.join(', ') || '-')} · 여 ${esc(b.peer.female.join(', ') || '-')}</span><small>${esc(b.peer.desc || '')}</small></div>` : '';
    return `<div class="sheet">${head}${body}${peer}<footer class="sh-foot">우리 반을 함께 돌보는 역할이에요. 맡은 일을 책임 있게 해 봐요!</footer></div>`;
  }
  async function renderSheetCanvas(b, kind) {
    if (!window.html2canvas) throw new Error('이미지 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
    const host = $('#sheetHost'); host.innerHTML = sheetHTML(b, kind);
    try { await document.fonts.ready; } catch (e) { /* 글꼴 대기 실패 무시 */ }
    const canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    host.innerHTML = '';
    return canvas;
  }
  function saveBlob(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function canvasToPdf(canvas) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const W = 210, H = 297, M = 0;
    const pageHpx = Math.floor(canvas.width * (H - M * 2) / (W - M * 2));
    if (canvas.height <= pageHpx * 1.12) { // 한 장에 맞춤 (조금 넘치면 축소)
      const h = Math.min(H, canvas.height * W / canvas.width); const w = h * canvas.width / canvas.height;
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', (W - w) / 2, 0, w, h);
    } else { // 여러 장으로 나누기
      for (let y = 0, p = 0; y < canvas.height; y += pageHpx, p++) {
        const part = document.createElement('canvas'); part.width = canvas.width; part.height = Math.min(pageHpx, canvas.height - y);
        const cx = part.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, part.width, part.height); cx.drawImage(canvas, 0, -y);
        if (p) pdf.addPage();
        pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, part.height * W / part.width);
      }
    }
    return pdf;
  }
  async function openDownload(board) {
    if (!board) { toast('먼저 역할을 뽑아 주세요.'); return; }
    let kind = 'role', canvas = null;
    openModal(`<h2>역할표 내려받기</h2><p class="small muted">${esc(board.className)} · A4 세로</p>
      <div class="row seg"><label class="switch"><input type="radio" name="dlKind" value="role" checked> 역할별 (하는 일 포함)</label>
        <label class="switch"><input type="radio" name="dlKind" value="student"> 학생 번호순</label></div>
      <div class="dl-prev" id="dlPrev"><p class="muted">만드는 중…</p></div>
      ${window.PREVIEW ? '<p class="small muted">미리보기 화면에서는 파일 저장이 막혀 있어요. 위 이미지를 오른쪽 클릭(휴대폰은 길게 눌러) 저장할 수 있고, 실제 배포본에서는 아래 버튼으로 바로 내려받아요.</p>' : ''}
      <div class="foot"><button class="btn" data-act="closeModal">닫기</button>
        ${window.PREVIEW ? '' : '<button class="btn" id="dlPng" disabled>이미지(PNG)</button><button class="btn primary" id="dlPdf" disabled>PDF</button>'}</div>`);
    const draw = async () => {
      $('#dlPrev').innerHTML = '<p class="muted">만드는 중…</p>';
      try {
        canvas = await renderSheetCanvas(board, kind);
        $('#dlPrev').innerHTML = `<img alt="${esc(board.className)} 역할표" src="${canvas.toDataURL('image/png')}">`;
        $$('#dlPng,#dlPdf').forEach((b) => (b.disabled = false));
      } catch (e) { $('#dlPrev').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
    };
    $$('input[name="dlKind"]').forEach((r) => (r.onchange = () => { kind = r.value; draw(); }));
    const base = () => `1인1역_${board.className}_${kind === 'role' ? '역할별' : '학생별'}`.replace(/[\\/:*?"<>|]/g, '');
    const png = $('#dlPng'), pdf = $('#dlPdf');
    if (png) png.onclick = () => canvas && canvas.toBlob((b) => saveBlob(b, base() + '.png'), 'image/png');
    if (pdf) pdf.onclick = () => {
      if (!canvas) return;
      if (!window.jspdf) { toast('PDF 라이브러리를 불러오지 못했어요.'); return; }
      canvasToPdf(canvas).save(base() + '.pdf');
    };
    draw();
  }

  /* =========================================================
   * 학생 화면 (키오스크 / 학생 개인 기기)
   * ========================================================= */
  let K = null;
  // ctx: { mode:'prefs'|'vote'|'both', solo:boolean, settings, save:{pref,vote}, result, no }
  function openKiosk(opt) {
    const st = opt.settings || T();
    K = { mode: opt.mode || 'both', solo: !!opt.solo, fromLanding: !!opt.fromLanding, st, step: 'num', no: null, pin: '', choices: [], double: false, vol: false, male: [], female: [],
      api: opt.api || teacherApi, result: opt.result || null, peerPick: opt.peerPick || null };
    const k = $('#kiosk'); k.hidden = false; if (K.solo) k.classList.add('solo');
    if (opt.no) { K.no = +opt.no; afterIdentify(); } else kRender();
  }
  const teacherApi = {
    async savePref(no, data) { await Store.savePref(no, data); if (Store.kind === 'local') syncPeerCandidates(); },
    async saveVote(no, data) { await Store.saveVote(no, data); },
    getPref: async (no) => S.prefs[no] || null,
    getVote: async (no) => S.votes[no] || null,
    checkPin: (no, pin) => !T().usePin || !S.pins[no] || S.pins[no] === pin,
    done: (no) => ({ pref: !!S.prefs[no], vote: !!S.votes[no] }),
  };
  async function closeKiosk() {
    if (K && K.fromLanding) { $('#kiosk').hidden = true; K = null; Store.leave(); render(); return; }
    const tp = LS.get('roleonair:tpin');
    if (tp && (await ask('선생님 비밀번호를 입력하세요', { input: true })) !== tp) { toast('비밀번호가 달라요.'); return; }
    $('#kiosk').hidden = true; K = null; render();
  }
  function steps() {
    const st = K.st; const out = [];
    const prefsOn = K.mode === 'prefs' || (K.mode === 'both' && st.prefsOpen);
    const voteOn = st.peer.enabled && (K.mode === 'vote' || (K.mode === 'both' && st.votesOpen));
    if (prefsOn) out.push('prefs'); if (voteOn) out.push('vote');
    return out;
  }
  function kHeader(title) {
    return `<div class="k-top"><div class="row"><span class="lamp"></span><b class="display" style="font-size:20px">${esc(K.st.className)} · ${title}</b></div>
      ${K.solo ? `<span class="small" style="opacity:.75">${K.code ? '반코드 ' + esc(K.code) : ''}</span>` : `<button class="btn sm" id="kExit">${K.fromLanding ? '나가기 ↩' : '선생님 화면 ↩'}</button>`}</div>`;
  }
  function kRender() {
    const k = $('#kiosk'); const st = K.st;
    const title = K.mode === 'vote' ? '또래상담자 투표' : K.mode === 'prefs' ? '1인1역 희망 고르기' : '1인1역';
    let html = kHeader(title) + '<div class="k-body">';
    if (K.step === 'num') {
      const done = (no) => (K.api.done ? K.api.done(no) : {});
      html += `${K.result && K.result.published ? '<button class="btn big red" id="kBoard" style="margin-bottom:12px">역할 발표 보기</button>' : ''}
        <div class="k-title">내 번호를 눌러요</div><p class="muted">${K.solo ? '' : '다 하면 다음 친구에게 넘겨 주세요.'}</p>
        <div class="numgrid">${st.students.map((s) => { const d = done(s.no); const ok = K.mode === 'vote' ? d.vote : d.pref; return `<button class="numbtn ${ok ? 'done' : ''}" data-kno="${s.no}"><b>${s.no}</b>${esc(s.name)}${ok ? ' ✓' : ''}</button>`; }).join('')}</div>`;
    } else if (K.step === 'pin') {
      const s = K.st.students.find((x) => +x.no === K.no);
      html += `<div class="k-title" style="text-align:center">${s.no}번 ${esc(s.name)}</div><p class="muted" style="text-align:center">선생님께 받은 확인코드 4자리를 눌러요</p>
        <div class="pindots">${[0, 1, 2, 3].map((i) => `<i class="${i < K.pin.length ? 'f' : ''}"></i>`).join('')}</div>
        <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '←', 0, '취소'].map((x) => `<button data-pin="${x}">${x}</button>`).join('')}</div>`;
    } else if (K.step === 'prefs') {
      html += kPrefsView();
    } else if (K.step === 'vote') {
      html += kVoteView();
    } else if (K.step === 'done') {
      html += `<div class="done-big"><div class="em ok">✓</div><div class="k-title">제출했어요!</div>
        <p class="muted">${K.solo ? '고치고 싶으면 마감 전에 다시 제출하면 돼요.<br>이 화면을 켜 두면 역할 뽑기를 생방송으로 볼 수 있어요.' : '다음 친구에게 넘겨 주세요.'}</p>
        ${K.solo ? '<button class="btn big" id="kAgain">처음으로</button>' : ''}</div>`;
    } else if (K.step === 'closed') {
      html += `<div class="done-big"><div class="em">‖</div><div class="k-title">지금은 입력 시간이 아니에요</div><p class="muted">${K.solo ? '이 화면을 켜 두면 선생님이 시작하거나 뽑을 때 바로 바뀌어요.' : '선생님이 시작하면 다시 들어와 주세요.'}</p>${kMyResult()}</div>`;
    } else if (K.step === 'board') {
      html += kBoardView();
    }
    html += '</div>';
    k.innerHTML = html;
    const ex = $('#kExit'); if (ex) ex.onclick = () => closeKiosk();
    const ag = $('#kAgain'); if (ag) ag.onclick = () => { K.step = 'num'; K.no = null; kRender(); };
    const kb = $('#kBoard'); if (kb) kb.onclick = () => { K.step = 'board'; kRender(); };
    const kh = $('#kHome'); if (kh) kh.onclick = () => { K.step = 'num'; kRender(); };
  }
  function kBoardView() {
    const st = K.st, res = K.result || {}; const by = res.byStudent || {};
    const nm = (no) => (st.students.find((s) => +s.no === +no) || {}).name || `${no}번`;
    const cards = st.roles.filter((r) => r.count > 0).map((r, i) => {
      const who = Object.entries(by).filter(([, l]) => l.some((x) => x.roleId === r.id)).map(([no]) => +no).sort((a, b) => a - b);
      return `<div class="rcard ${who.includes(K.no) ? 'me' : ''}" style="animation-delay:${Math.min(i * 60, 1800)}ms"><h4><span>${esc(r.name)}</span></h4><div class="d">${esc(r.desc)}</div>
        <div class="who">${who.map((no) => `<span class="chip ${+no === K.no ? 'me' : ''}">${esc(nm(no))}</span>`).join('') || '<span class="chip empty">빈자리</span>'}</div></div>`;
    }).join('');
    const pp = K.peerPick;
    return `<div class="k-title">${esc(st.className)} 1인1역 발표!</div>
      ${kMyResult()}
      ${pp && st.peer.enabled ? `<section class="card crown"><b>${esc(st.peer.title)}</b> <span class="small">${[...(pp.male || []), ...(pp.female || [])].map((n) => esc(nm(n))).join(', ')}</span></section>` : ''}
      <div class="rcards">${cards}</div>
      <div style="text-align:center;margin-top:18px"><button class="btn big" id="kHome">${K.no ? '← 처음으로' : '내 번호 누르기'}</button></div>`;
  }
  function kMyResult() {
    if (!K.result || !K.result.published || !K.no) return '';
    const list = (K.result.byStudent || {})[K.no] || [];
    const roles = list.map((x) => K.st.roles.find((r) => r.id === x.roleId)).filter(Boolean);
    const peer = K.peerPick && [...(K.peerPick.male || []), ...(K.peerPick.female || [])].includes(K.no);
    return `<section class="card crown" style="text-align:left;max-width:520px;margin:20px auto">
      <h3>나의 1인1역</h3>${roles.map((r) => `<div style="margin-top:8px"><b class="display" style="font-size:22px">${esc(r.name)}</b><div class="small muted">${esc(r.desc)}</div></div>`).join('') || '<p class="muted">아직 없어요.</p>'}
      ${peer ? `<div style="margin-top:10px"><b>${esc(K.st.peer.title)}</b>로도 뽑혔어요!</div>` : ''}</section>`;
  }
  function kPrefsView() {
    const st = K.st; const max = Math.min(st.maxChoices, st.roles.length);
    const forb = (r) => C.isForbidden(st, K.no, r);
    const avail = st.roles.filter((r) => !forb(r) && r.count > 0).length;
    const need = Math.min(st.minChoices, avail);
    const s = st.students.find((x) => +x.no === K.no);
    const picked = K.choices.map((id, i) => {
      const r = st.roles.find((x) => x.id === id);
      return `<span class="pk"><i>${i + 1}</i>${esc(r ? r.name : '')}
        ${i > 0 ? `<button class="mv" data-kmv="${i}" title="앞으로">◀</button>` : ''}<button data-kdel="${id}">×</button></span>`;
    }).join('');
    const cards = st.roles.filter((r) => r.count > 0).map((r) => {
      const idx = K.choices.indexOf(r.id); const no = forb(r);
      return `<button class="rbtn ${idx >= 0 ? 'sel' : ''} ${no ? 'no' : ''}" data-krole="${r.id}" ${no ? 'disabled' : ''}>
        <em>${idx >= 0 ? idx + 1 + '지망' : r.count + '명'}</em><b>${esc(r.name)}</b><span>${no ? '직전에 맡았던 역할이라 이번엔 고를 수 없어요' : esc(r.desc)}</span></button>`;
    }).join('');
    const ok = K.choices.length >= need;
    const more = steps().indexOf('prefs') < steps().length - 1;
    return `${kMyResult()}<div class="k-title">${esc(s.name)}, 하고 싶은 역할을 순서대로 눌러요</div>
      <p class="muted">1지망부터 최대 ${max}지망까지 · 최소 ${need}개 · 다시 누르면 빠져요</p>
      <div class="picked">${picked || '<span class="muted">아래에서 역할을 눌러 주세요</span>'}</div>
      <div class="rolegrid">${cards}</div>
      <div class="field" style="margin-top:16px;gap:10px">
        ${st.allowDouble ? sw('id="kDouble"', K.double, '자리가 남으면 역할 2개도 할 수 있어요') : ''}
        ${st.peer.enabled && st.peer.candidates === 'volunteer' ? sw('id="kVol"', K.vol, `${esc(st.peer.title)}로 봉사하고 싶어요`) : ''}
      </div>
      <div class="k-foot"><button class="btn big" id="kBack">← 번호 다시</button>
        <button class="btn big primary" id="kSubmitPref" ${ok ? '' : 'disabled'}>${more ? '다음: 또래상담 투표 →' : '제출하기 ✓'}</button></div>`;
  }
  function kVoteView() {
    const st = K.st; const p = st.peer; const per = p.votesPerGender;
    let cand = st.students.filter((s) => +s.no !== K.no);
    if (p.candidates === 'volunteer') cand = cand.filter((s) => (st.peerCandidates || []).includes(+s.no));
    const col = (k, g, c) => {
      const list = cand.filter((s) => s.gender === g);
      return `<div class="votecol"><h3 class="g-${g}">${g}학생 (${K[k].length}/${per})</h3>
        <div class="vgrid">${list.map((s) => `<button class="vbtn ${c} ${K[k].includes(+s.no) ? 'sel' : ''}" data-kv="${k}" data-no="${s.no}">${s.no}. ${esc(s.name)}</button>`).join('') || '<span class="muted small">후보가 없어요</span>'}</div></div>`;
    };
    return `<div class="k-title">${esc(p.title)} 투표</div>
      <p class="muted">${esc(p.desc)}<br>믿고 고민을 이야기할 수 있는 친구를 성별마다 ${per}명까지 골라요. 아무도 내가 누구를 골랐는지 몰라요.</p>
      ${col('male', '남', 'b')}${col('female', '여', 'g')}
      <div class="k-foot"><button class="btn big" id="kBack">← 뒤로</button><button class="btn big primary" id="kSubmitVote" ${K.male.length + K.female.length ? '' : 'disabled'}>투표하기 ✓</button></div>`;
  }
  async function afterIdentify() {
    const st = K.st;
    const ss = steps();
    if (!ss.length) { K.step = K.result && K.result.published ? 'board' : 'closed'; kRender(); return; }
    try {
      const p = await K.api.getPref(K.no);
      if (p) { K.choices = (p.choices || []).filter((id) => st.roles.some((r) => r.id === id)); K.double = !!p.double; K.vol = !!p.peerVolunteer; }
      else { K.choices = []; K.double = false; K.vol = false; }
      const v = await K.api.getVote(K.no);
      K.male = v ? (v.male || []) : []; K.female = v ? (v.female || []) : [];
    } catch (e) { K.choices = []; K.male = []; K.female = []; }
    K.step = ss[0]; kRender(); window.scrollTo(0, 0); $('#kiosk').scrollTop = 0;
  }
  $('#kiosk').addEventListener('click', async (e) => {
    if (!K) return;
    const t = e.target.closest('button'); if (!t) return;
    const st = K.st;
    if (t.dataset.kno) {
      K.no = +t.dataset.kno; K.pin = '';
      if (st.usePin) { K.step = 'pin'; kRender(); } else afterIdentify();
      return;
    }
    if (t.dataset.pin != null) {
      const x = t.dataset.pin;
      if (x === '취소') { K.step = 'num'; K.no = null; kRender(); return; }
      if (x === '←') K.pin = K.pin.slice(0, -1); else if (K.pin.length < 4) K.pin += x;
      if (K.pin.length === 4) {
        const ok = K.api.checkPin(K.no, K.pin);
        if (ok === false) { toast('확인코드가 달라요.'); K.pin = ''; kRender(); return; }
        afterIdentify(); return;
      }
      kRender(); return;
    }
    if (t.dataset.krole) {
      const id = t.dataset.krole; const max = Math.min(st.maxChoices, st.roles.length);
      if (K.choices.includes(id)) K.choices = K.choices.filter((x) => x !== id);
      else if (K.choices.length < max) K.choices.push(id);
      else toast(`${max}지망까지만 고를 수 있어요.`);
      keepScroll(kRender); return;
    }
    if (t.dataset.kdel) { K.choices = K.choices.filter((x) => x !== t.dataset.kdel); keepScroll(kRender); return; }
    if (t.dataset.kmv) { const i = +t.dataset.kmv; [K.choices[i - 1], K.choices[i]] = [K.choices[i], K.choices[i - 1]]; keepScroll(kRender); return; }
    if (t.dataset.kv) {
      const k = t.dataset.kv, no = +t.dataset.no; const per = st.peer.votesPerGender;
      if (K[k].includes(no)) K[k] = K[k].filter((x) => x !== no);
      else if (K[k].length < per) K[k] = K[k].concat(no);
      else toast(`${per}명까지 고를 수 있어요.`);
      keepScroll(kRender); return;
    }
    if (t.id === 'kBack') {
      const ss = steps(); const i = ss.indexOf(K.step);
      if (i > 0) K.step = ss[i - 1]; else { K.step = 'num'; K.no = null; }
      kRender(); return;
    }
    if (t.id === 'kSubmitPref') {
      const data = { choices: K.choices.slice(), double: !!($('#kDouble') && $('#kDouble').checked), peerVolunteer: !!($('#kVol') && $('#kVol').checked), at: Date.now() };
      K.double = data.double; K.vol = data.peerVolunteer;
      if (st.usePin) data.pin = K.pin || (S.pins[K.no] || '');
      t.disabled = true;
      try { await K.api.savePref(K.no, data); } catch (err) { t.disabled = false; toast(errMsg(err), 4000); return; }
      const ss = steps(); const i = ss.indexOf('prefs');
      if (i < ss.length - 1) { K.step = ss[i + 1]; kRender(); } else finishK();
      return;
    }
    if (t.id === 'kSubmitVote') {
      const v = { male: K.male.slice(), female: K.female.slice(), at: Date.now() };
      const msg = C.validateVote(st, K.no, v); if (msg) { toast(msg); return; }
      if (st.usePin) v.pin = K.pin || (S.pins[K.no] || '');
      t.disabled = true;
      try { await K.api.saveVote(K.no, v); } catch (err) { t.disabled = false; toast(errMsg(err), 4000); return; }
      finishK(); return;
    }
  });
  function keepScroll(fn) { const k = $('#kiosk'); const y = k.scrollTop, wy = window.scrollY; fn(); k.scrollTop = y; window.scrollTo(0, wy); }
  function errMsg(err) {
    const m = String(err && (err.code || err.message) || err);
    if (/permission/i.test(m)) return K && K.st.usePin ? '제출이 막혔어요. 확인코드가 맞는지, 입력 시간이 열려 있는지 확인해 주세요.' : '제출이 막혔어요. 입력 시간이 열려 있는지 선생님께 물어보세요.';
    return '제출하지 못했어요: ' + m;
  }
  function finishK() {
    K.step = 'done'; kRender();
    if (!K.solo) setTimeout(() => { if (K && K.step === 'done') { K.step = 'num'; K.no = null; K.pin = ''; kRender(); } }, 2500);
  }

  /* =========================================================
   * 학생 화면 — 생방송 따라가기 (클라우드)
   * ========================================================= */
  let studentDrumT = null;
  function studentDrum(on) {
    const d = $('#drum');
    clearInterval(studentDrumT); studentDrumT = null;
    if (!on) { d.hidden = true; return; }
    const st = K.st; const names = st.students.map((s) => s.name); const roles = st.roles.map((r) => r.name);
    d.hidden = false;
    d.innerHTML = `<span class="lamp"></span><div class="lbl2">생방송 · ${esc(st.className)}</div><div class="roll" id="roll"></div><div class="sub" id="rollSub"></div>
      <p style="opacity:.6;margin-top:24px">선생님이 지금 역할을 뽑고 있어요!</p>`;
    studentDrumT = setInterval(() => {
      const r = $('#roll'), s = $('#rollSub'); if (!r) return;
      r.textContent = roles[Math.floor(Math.random() * roles.length)] || '';
      s.textContent = names[Math.floor(Math.random() * names.length)] || '';
    }, 110);
    setTimeout(() => studentDrum(false), 90000); // 안전장치
  }
  async function onStudentLive(pub, fetchResult) {
    if (!K || !K.solo) return;
    const prevOpen = steps().join();
    K.st = { ...defaults(), ...pub, peer: { ...defaults().peer, ...(pub.peer || {}) } };
    const live = pub.live || {};
    if (live.at && live.at !== K.liveAt) {
      K.liveAt = live.at;
      if (live.state === 'drawing') studentDrum(true);
      if (live.state === 'reveal') {
        studentDrum(false);
        const r = await fetchResult();
        if (r) { K.result = r; K.peerPick = r.peer || null; if (!['prefs', 'vote', 'pin'].includes(K.step)) { K.step = 'board'; kRender(); window.scrollTo(0, 0); } else toast('역할 발표! 제출을 마치면 결과를 볼 수 있어요.'); return; }
      }
      if (live.state === 'idle') { studentDrum(false); K.result = null; if (K.step === 'board') { K.step = K.no ? 'closed' : 'num'; } }
    }
    // 입력 시간이 새로 열리거나 닫히면 화면 갱신
    if (steps().join() !== prevOpen && ['closed', 'done', 'num', 'board'].includes(K.step)) {
      if (K.no && steps().length && K.step !== 'board') { afterIdentify(); return; }
    }
    if (['closed', 'done', 'num'].includes(K.step)) kRender();
  }

  /* =========================================================
   * 시작
   * ========================================================= */

  /* ---------- 미리보기용 예시 데이터 (예시 반 2개) ---------- */
  async function seedSample() {
    const names2 = '김민수 이서연 박지호 최유나 정하준 강서윤 조도윤 윤지아 장시우 임하린 한준서 오채원 서지후 신예린 권민준 황수아 안건우 송다은 류현우 전소율 홍재민 고나연 문태윤 양지유'.split(' ');
    const names1 = '오지훈 김하은 이도현 박서진 최준우 정예나 강민재 조수빈 윤태호 장유진 임건 한소희 서동현 신지민 권우진 황채린 안시후 송하율 류지성 전다인 홍민규 고은서'.split(' ');
    // 1반: 이미 뽑기를 마친 반
    await Local.create('예시) 5학년 1반', '000000');
    S.settings.students = names1.map((name, i) => ({ no: i + 1, name, gender: i % 2 ? '여' : '남' }));
    S.settings.roles = S.settings.roles.slice(0, 18);
    S.settings.students.forEach((s) => { S.prefs[s.no] = { choices: C.shuffle(S.settings.roles.map((r) => r.id)).slice(0, 7), double: s.no % 7 === 0, at: Date.now() }; });
    S.result = { ...C.assignRoles(S.settings, S.prefs), published: false }; recompute(S.result);
    S.peerPick = { male: [1, 5], female: [2, 8], at: Date.now() };
    Local.saveAll();
    // 2반: 희망을 받는 중인 반
    await Local.create('예시) 5학년 2반', '000000');
    const st = S.settings;
    st.students = names2.map((name, i) => ({ no: i + 1, name, gender: i % 2 ? '여' : '남' }));
    st.roles[0].repeatable = false; st.roles[4].repeatable = false;
    st.prevRoles = { 1: [st.roles[0].name], 4: [st.roles[4].name] };
    const ids = st.roles.map((r) => r.id);
    st.students.slice(0, 16).forEach((s, i) => {
      const pool = C.shuffle(ids.filter((id) => !C.isForbidden(st, s.no, roleById(id))));
      S.prefs[s.no] = { choices: pool.slice(0, 5 + (i % 3)), double: i % 6 === 0, peerVolunteer: false, at: Date.now() };
    });
    const v = { 3: [[1, 5], [2, 4]], 6: [[3, 7], [4, 10]], 8: [[3, 1], [2, 12]], 9: [[5, 3], [4, 2]], 12: [[3, 9], [2, 4]], 13: [[1, 7], [4, 6]] };
    Object.entries(v).forEach(([no, [m, f]]) => (S.votes[no] = { male: m.filter((x) => x !== +no), female: f.filter((x) => x !== +no), at: Date.now() }));
    st.prefsOpen = true;
    Local.saveAll();
    LocalGrade.put({ name: '예시) 2026 5학년', templates: [{ id: C.uid(), name: '5학년 기본 역할', roles: clone(defaults().roles), byName: '예시) 5학년 1반', at: Date.now() }] });
    Local.leave();
  }
  async function bootLocal() {
    Store = Local; Grade = LocalGrade;
    Local.migrate();
    if (window.PREVIEW && !Local.list().length) await seedSample();
    const cur = LS.get(CUR);
    if (cur && Local.has(cur) && !window.PREVIEW) await Local.open(cur);
    render();
  }

  // ---------- 클라우드: 선생님 ----------
  async function bootCloudTeacher() {
    Store = Cloud; Grade = CloudGrade;
    const saved = LS.get('roleonair:class');
    if (saved && (await Cloud.isOwner(saved))) { try { await Cloud.open(saved); } catch (e) { Cloud.leave(); } }
    render();
  }

  // ---------- 클라우드: 학생 ----------
  async function bootCloudStudent(code) {
    document.querySelector('.top').hidden = true; $('#main').hidden = true;
    const k = $('#kiosk'); k.hidden = false; k.classList.add('solo');
    k.innerHTML = `<div class="done-big"><div class="em live"></div><div class="k-title">연결 중…</div></div>`;
    try {
      await ensureAnon();
      const uid = FB.auth.currentUser.uid;
      const ref = (...p) => FB.doc(FB.db, 'classes', code, ...p);
      const snap = await FB.getDoc(ref());
      if (!snap.exists()) throw new Error(`반코드 ${code}를 찾을 수 없어요. 숫자 6자리를 다시 확인해 주세요.`);
      const pub = snap.data().pub || {};
      const st = { ...defaults(), ...pub }; st.peer = { ...defaults().peer, ...st.peer };
      const fetchResult = async () => { try { const r = await FB.getDoc(ref('result', 'current')); return r.exists() && r.data().published ? r.data() : null; } catch (e) { return null; } };
      const result = await fetchResult();
      const api = {
        async savePref(no, data) { await FB.setDoc(ref('prefs', String(no)), { ...data, no: +no, uid }); },
        async saveVote(no, data) { await FB.setDoc(ref('votes', String(no)), { ...data, no: +no, uid }); },
        async getPref(no) { try { const d = await FB.getDoc(ref('prefs', String(no))); return d.exists() ? d.data() : null; } catch (e) { return null; } },
        async getVote(no) { try { const d = await FB.getDoc(ref('votes', String(no))); return d.exists() ? d.data() : null; } catch (e) { return null; } },
        checkPin: () => null, // 서버 규칙에서 확인
        done: () => ({}),
      };
      document.title = `${st.className} · 1인1역`;
      openKiosk({ mode: 'both', solo: true, settings: st, api, result, peerPick: result ? result.peer : null });
      K.liveAt = (pub.live || {}).at || 0; K.code = code;
      // ★ 생방송: 반 문서를 실시간으로 지켜봄 (입력 시작/마감, 뽑기 연출, 결과 발표)
      FB.onSnapshot(ref(), (s) => { if (s.exists()) onStudentLive(s.data().pub || {}, fetchResult); });
    } catch (e) {
      k.innerHTML = `<div class="done-big"><div class="em bad">!</div><div class="k-title">들어가지 못했어요</div><p class="muted">${esc(e.message)}</p>
        <a class="btn big" href="${esc(location.pathname)}">반코드 다시 넣기</a></div>`;
    }
  }

  (async function start() {
    const code = (new URLSearchParams(location.search).get('c') || '').trim();
    if (window.FIREBASE_CONFIG) {
      try { await loadFirebase(); }
      catch (e) { console.error(e); toast('Firebase 연결 실패 — 이 기기 저장 모드로 열어요. (익명 로그인이 켜져 있는지 확인)', 6000); return bootLocal(); }
      if (code) return bootCloudStudent(code);
      return bootCloudTeacher();
    }
    if (code) toast('Firebase가 연결되지 않아 학생 링크를 쓸 수 없어요. (★ firebase-config.js)', 6000);
    bootLocal();
  })();
})();
