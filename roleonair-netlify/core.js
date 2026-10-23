/* =========================================================
 * 1인1역 온에어 — 핵심 로직 (화면과 무관한 순수 함수 모음)
 *  - 역할 배정 (최소비용 유량 알고리즘)
 *  - 또래상담 투표 집계
 *  - 나이스 학생 명렬표 / 직접입력 명단 해석
 *  - 한글(HWP/HWPX)·PDF·엑셀에서 직전 역할 자동 인식
 * 브라우저에서는 window.Core, Node 테스트에서는 module.exports 로 사용
 * ========================================================= */
(function (root) {
  'use strict';

  /* ---------------- 공통 유틸 ---------------- */
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const uid = () => Math.random().toString(36).slice(2, 9);

  function shuffle(arr, rnd = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------------- 최소비용 유량 ---------------- */
  class MCMF {
    constructor(n) { this.n = n; this.g = Array.from({ length: n }, () => []); }
    add(u, v, cap, cost) {
      const a = { to: v, cap, cost, rev: this.g[v].length };
      const b = { to: u, cap: 0, cost: -cost, rev: this.g[u].length };
      this.g[u].push(a); this.g[v].push(b);
      return a;
    }
    run(s, t, maxFlow = Infinity) {
      let flow = 0, cost = 0;
      const n = this.n;
      while (flow < maxFlow) {
        // SPFA (음수 비용 간선 허용)
        const dist = new Array(n).fill(Infinity), inq = new Array(n).fill(false);
        const pv = new Array(n).fill(-1), pe = new Array(n).fill(-1);
        dist[s] = 0; const q = [s]; inq[s] = true;
        while (q.length) {
          const u = q.shift(); inq[u] = false;
          this.g[u].forEach((e, i) => {
            if (e.cap > 0 && dist[u] + e.cost < dist[e.to]) {
              dist[e.to] = dist[u] + e.cost; pv[e.to] = u; pe[e.to] = i;
              if (!inq[e.to]) { inq[e.to] = true; q.push(e.to); }
            }
          });
        }
        if (dist[t] === Infinity) break;
        let f = maxFlow - flow;
        for (let v = t; v !== s; v = pv[v]) f = Math.min(f, this.g[pv[v]][pe[v]].cap);
        for (let v = t; v !== s; v = pv[v]) {
          const e = this.g[pv[v]][pe[v]];
          e.cap -= f; this.g[v][e.rev].cap += f;
        }
        flow += f; cost += f * dist[t];
      }
      return { flow, cost };
    }
  }

  /* ---------------- 역할 배정 ----------------
   * settings: { roles:[{id,name,count,repeatable}], students:[{no,name}], prevRoles:{no:[역할명]},
   *             allowDouble, mode:'fair'|'first', maxChoices }
   * prefs: { no: { choices:[roleId...], double:bool } }
   * 반환: { byRole:{roleId:[no]}, byStudent:{no:[{roleId, rank}]}, unassigned:[no], unfilled:[{roleId,left}], stats }
   */
  function isForbidden(settings, no, role) {
    if (role.repeatable !== false) return false;
    const prev = (settings.prevRoles && settings.prevRoles[no]) || [];
    const n = normRole(role.name);
    return prev.some((p) => normRole(p) === n);
  }
  function normRole(s) { return clean(s).replace(/[\s()·\-]/g, '').replace(/(도우미|담당|지기|부장)$/,'$1'); }

  function assignRoles(settings, prefs = {}, opts = {}) {
    const rnd = opts.random || Math.random;
    const roles = (settings.roles || []).filter((r) => (r.count | 0) > 0);
    const students = settings.students || [];
    const maxC = Math.max(1, settings.maxChoices || 7);
    const fair = (settings.mode || 'fair') === 'fair';
    const UNRANK = fair ? (maxC + 2) * (maxC + 2) * 100 : (maxC + 2) * 100;
    const rankCost = (r) => (fair ? (r + 1) * (r + 1) * 100 : (r + 1) * 100);
    const BIG = 10000000;

    const rankOf = (no, roleId) => {
      const p = prefs[no];
      if (!p || !Array.isArray(p.choices)) return -1;
      return p.choices.indexOf(roleId);
    };
    // 학생/역할 순서를 섞어 동점일 때 '뽑기' 효과
    const S = shuffle(students, rnd), R = shuffle(roles, rnd);
    const byRole = {}; roles.forEach((r) => (byRole[r.id] = []));
    const byStudent = {}; students.forEach((s) => (byStudent[s.no] = []));
    const fixed = opts.fixed || {}; // {no: roleId} 선생님이 미리 정한 배정
    const remain = {}; roles.forEach((r) => (remain[r.id] = r.count | 0));
    Object.keys(fixed).forEach((no) => {
      const rid = fixed[no];
      if (remain[rid] > 0 && byStudent[no]) {
        remain[rid]--; byRole[rid].push(+no);
        byStudent[no].push({ roleId: rid, rank: rankOf(no, rid), fixed: true });
      }
    });

    function phase(cands, costFn) {
      const nS = cands.length, nR = R.length;
      const N = 2 + nS + nR;
      const T = N - 1;
      const g = new MCMF(N);
      const edges = [];
      cands.forEach((s, i) => {
        g.add(0, 1 + i, 1, 0);
        R.forEach((r, j) => {
          if (remain[r.id] <= 0) return;
          if (byStudent[s.no].some((x) => x.roleId === r.id)) return;
          if (isForbidden(settings, s.no, r)) return;
          const c = costFn(s, r);
          if (c == null) return;
          edges.push({ e: g.add(1 + i, 1 + nS + j, 1, c + Math.floor(rnd() * 60)), s, r });
        });
      });
      R.forEach((r, j) => {
        const node = 1 + nS + j;
        const cap = remain[r.id];
        if (cap <= 0) return;
        // 아직 아무도 없는 역할의 첫 자리는 우선 채움 (빈 역할 방지)
        if (byRole[r.id].length === 0) { g.add(node, T, 1, -BIG); if (cap > 1) g.add(node, T, cap - 1, 0); }
        else g.add(node, T, cap, 0);
      });
      g.run(0, T);
      edges.forEach(({ e, s, r }) => {
        if (e.cap === 0) {
          remain[r.id]--; byRole[r.id].push(s.no);
          byStudent[s.no].push({ roleId: r.id, rank: rankOf(s.no, r.id) });
        }
      });
    }

    // 1단계: 모든 학생이 역할 1개씩
    const phase1 = S.filter((s) => byStudent[s.no].length === 0);
    phase(phase1, (s, r) => { const k = rankOf(s.no, r.id); return k >= 0 ? rankCost(k) : UNRANK; });

    // 2단계: 남은 자리 → 1인 2역 (희망 학생 우선)
    let left = Object.values(remain).reduce((a, b) => a + b, 0);
    if (settings.allowDouble !== false && left > 0) {
      const cands = S.filter((s) => byStudent[s.no].length === 1);
      phase(cands, (s, r) => {
        const k = rankOf(s.no, r.id);
        const base = k >= 0 ? rankCost(k) : UNRANK;
        const wants = prefs[s.no] && prefs[s.no].double;
        return base + (wants ? 0 : BIG / 10);
      });
    }

    const unassigned = students.filter((s) => byStudent[s.no].length === 0).map((s) => s.no);
    const unfilled = roles.filter((r) => remain[r.id] > 0).map((r) => ({ roleId: r.id, left: remain[r.id] }));
    Object.keys(byRole).forEach((k) => byRole[k].sort((a, b) => a - b));
    return { byRole, byStudent, unassigned, unfilled, stats: statsOf(byStudent, maxC), at: Date.now() };
  }

  function statsOf(byStudent, maxC = 7) {
    const ranks = new Array(maxC).fill(0); let other = 0, total = 0;
    Object.values(byStudent).forEach((list) => list.forEach((x, i) => {
      if (i > 0) return; // 첫 역할 기준
      total++;
      if (x.rank >= 0 && x.rank < maxC) ranks[x.rank]++; else other++;
    }));
    return { ranks, other, total };
  }

  /* ---------------- 또래상담 투표 집계 ----------------
   * votes: { voterNo: { male:[no], female:[no] } }
   * 반환: { male:{ranking:[{no,votes}], picked:[no], tied:[no], tiedNeed}, female:{...}, voters }
   */
  function tallyPeer(settings, votes = {}, prefs = {}) {
    const peer = settings.peer || {};
    const out = { voters: Object.keys(votes).length };
    [['male', '남'], ['female', '여']].forEach(([key, g]) => {
      const need = Math.max(0, peer[key] | 0);
      let cands = (settings.students || []).filter((s) => s.gender === g);
      if (peer.candidates === 'volunteer') cands = cands.filter((s) => prefs[s.no] && prefs[s.no].peerVolunteer);
      const cnt = {}; cands.forEach((s) => (cnt[s.no] = 0));
      Object.entries(votes).forEach(([voter, v]) => {
        const list = Array.from(new Set((v && v[key]) || []));
        list.slice(0, peer.votesPerGender || 2).forEach((no) => {
          if (String(no) === String(voter)) return; // 자기 자신 투표 무효
          if (cnt[no] != null) cnt[no]++;
        });
      });
      const ranking = Object.entries(cnt).map(([no, v]) => ({ no: +no, votes: v }))
        .sort((a, b) => b.votes - a.votes || a.no - b.no);
      const res = { ranking, picked: [], tied: [], tiedNeed: 0 };
      if (need > 0 && ranking.length) {
        if (ranking.length <= need) res.picked = ranking.map((r) => r.no);
        else {
          const cut = ranking[need - 1].votes;
          const above = ranking.filter((r) => r.votes > cut);
          const at = ranking.filter((r) => r.votes === cut);
          res.picked = above.map((r) => r.no);
          if (above.length + at.length === need) res.picked = res.picked.concat(at.map((r) => r.no));
          else { res.tied = at.map((r) => r.no); res.tiedNeed = need - above.length; }
        }
      }
      out[key] = res;
    });
    return out;
  }

  function validateVote(settings, voterNo, vote) {
    const peer = settings.peer || {}; const per = peer.votesPerGender || 2;
    const byNo = {}; (settings.students || []).forEach((s) => (byNo[s.no] = s));
    for (const [key, g] of [['male', '남'], ['female', '여']]) {
      const list = (vote && vote[key]) || [];
      if (list.length > per) return `${g}학생은 ${per}명까지 고를 수 있어요.`;
      if (new Set(list).size !== list.length) return '같은 친구를 두 번 고를 수 없어요.';
      for (const no of list) {
        if (+no === +voterNo) return '자기 자신은 뽑을 수 없어요.';
        if (!byNo[no] || byNo[no].gender !== g) return '후보가 아닌 학생이 있어요.';
      }
    }
    return '';
  }

  /* ---------------- 학생 명단 ---------------- */
  function normGender(v) {
    const s = clean(v).toLowerCase();
    if (/^(남|남자|남학생|m|male|boy)$/.test(s)) return '남';
    if (/^(여|여자|여학생|f|female|girl)$/.test(s)) return '여';
    return '';
  }
  const isKoreanName = (s) => /^[가-힣]{2,5}$/.test(s) || /^[가-힣]{1,4}\s?[A-Za-z가-힣]{1,10}$/.test(s) && s.length <= 12;

  // 엑셀 2차원 배열(rows) → [{no,name,gender}]  (나이스 학생명렬표, 출석부 등)
  function parseRosterRows(rows) {
    rows = (rows || []).map((r) => (r || []).map(clean));
    let h = -1, cNo = -1, cName = -1, cG = -1;
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const r = rows[i];
      const ni = r.findIndex((c) => /^(성\s*명|이\s*름|학생\s*명|학생\s*이름)$/.test(c));
      if (ni >= 0) {
        h = i; cName = ni;
        const look = [r, rows[i + 1] || [], rows[i - 1] || []];
        for (const rr of look) {
          if (cNo < 0) cNo = rr.findIndex((c) => /^(번\s*호|번|출석\s*번호)$/.test(c));
          if (cG < 0) cG = rr.findIndex((c) => /^성\s*별$/.test(c));
        }
        if (cNo < 0) cNo = r.findIndex((c) => /학번/.test(c));
        break;
      }
    }
    const out = []; const seen = new Set();
    const push = (no, name, gender) => {
      name = clean(name).replace(/\s+/g, '');
      if (!name || !no || seen.has(no)) return;
      seen.add(no); out.push({ no, name, gender: normGender(gender) });
    };
    if (h >= 0) {
      for (let i = h + 1; i < rows.length; i++) {
        const r = rows[i]; const name = r[cName];
        if (!name || /^(성\s*명|이\s*름)$/.test(name) || !/[가-힣A-Za-z]/.test(name)) continue;
        if (/(합계|계|남|여)\s*[:：]?\s*\d+/.test(name)) continue;
        let no = cNo >= 0 ? parseInt(String(r[cNo]).replace(/\D/g, ''), 10) : out.length + 1;
        if (no > 100) no = no % 100; // 학번(30315) → 15번
        if (!no) no = out.length + 1;
        let g = cG >= 0 ? r[cG] : r.find((c) => normGender(c));
        push(no, name, g);
      }
    } else {
      rows.forEach((r) => {
        const numIdx = r.findIndex((c) => /^\d{1,5}$/.test(c));
        const nameIdx = r.findIndex((c) => /^[가-힣]{2,5}$/.test(c) && !normGender(c));
        if (nameIdx < 0) return;
        let no = numIdx >= 0 ? parseInt(r[numIdx], 10) : out.length + 1;
        if (no > 100) no = no % 100;
        push(no, r[nameIdx], r.find((c) => normGender(c)));
      });
    }
    return out.sort((a, b) => a.no - b.no);
  }

  // 직접 입력: "1 김민수 남" / "1,김민수,여" / 탭 구분(엑셀 복사)
  function parseRosterText(text) {
    const rows = String(text || '').split(/\r?\n/).map((l) => l.split(/[\t,]+|\s+/).filter(Boolean));
    const out = []; let auto = 1;
    rows.forEach((cells) => {
      if (!cells.length) return;
      let no = null, name = '', g = '';
      cells.forEach((c) => {
        if (no == null && /^\d{1,5}\.?$/.test(c)) no = parseInt(c, 10);
        else if (normGender(c)) g = normGender(c);
        else if (!name && /[가-힣A-Za-z]/.test(c)) name = c;
      });
      if (!name) return;
      if (no == null) no = auto; if (no > 100) no = no % 100;
      auto = no + 1;
      out.push({ no, name, gender: g });
    });
    const seen = new Set();
    return out.filter((s) => (seen.has(s.no) ? false : seen.add(s.no))).sort((a, b) => a.no - b.no);
  }

  /* ---------------- 직전 역할 자동 인식 ----------------
   * rows: 문서에서 뽑은 '행' 배열. 표의 한 줄 = [칸, 칸, ...], 일반 문단 = [문장]
   * roster: 학생 명단 (이름으로 직전 수행자 연결)
   * 반환: [{name, desc, holders:[이름]}]
   */
  const TITLE_LIKE = /(1\s*인\s*1\s*역|일인일역|역할\s*(표|분담|안내|목록)|학년도|학기)/;
  const looksDesc = (c) => c.length > 12 || (/\s/.test(c) && /(요|다|함|음|임|기|하기|니다|세요)\.?$/.test(c) && c.length > 7);
  const HEADER_WORDS = /^(번호|순|no\.?|역할|역할명|1인\s*1역|일인일역|하는\s*일|할\s*일|활동\s*내용|내용|담당|담당자|이름|성명|학생|비고|인원|명|확인|역할\s*안내|구분|시간|요일|월|화|수|목|금|체크|평가|\d+\s*학년.*|\d+\s*반.*|.*학기.*|.*학년도.*)$/i;

  function splitInline(s) {
    // "칠판지기 - 쉬는 시간 칠판 지우기 (김민수, 이서연)" 같은 한 줄 처리
    const names = []; let t = s;
    t = t.replace(/[(（\[]([^)）\]]*)[)）\]]/g, (m, inner) => { names.push(inner); return ' '; });
    const m = t.split(/\s*[:：|｜\-–—=>→]\s*/).map(clean).filter(Boolean);
    return { parts: m, extra: names.join(',') };
  }

  function extractRolesFromRows(rows, roster = []) {
    const nameSet = new Set(roster.map((s) => s.name));
    const findNames = (txt) => {
      const found = [];
      roster.forEach((s) => { if (s.name.length >= 2 && txt.includes(s.name)) found.push(s.name); });
      return found;
    };
    const stripNo = (s) => clean(s).replace(/^(\d{1,2}\s*[.)번]|[①-⑳]|[-•·▪■□○●◦*]+)\s*/, '').trim();
    const isName = (c) => nameSet.has(c.replace(/^\d{1,2}\s*/, '').replace(/\s/g, '')) ||
      (roster.length === 0 && /^\d{1,2}\s*[가-힣]{2,4}$/.test(c));
    const roleLike = (c) => c && c.length >= 2 && c.length <= 16 && /[가-힣A-Za-z]/.test(c) &&
      !HEADER_WORDS.test(c) && !isName(c) && !/^\d+\s*(명|인)?$/.test(c) &&
      !/[.?!]$/.test(c) && c.split(' ').length <= 4 && !TITLE_LIKE.test(c);

    const roles = []; const byName = {};
    const getRole = (name) => {
      const key = normRole(name);
      if (!byName[key]) { byName[key] = { name, desc: '', holders: [], count: 0 }; roles.push(byName[key]); }
      return byName[key];
    };
    let last = null;
    (rows || []).forEach((row) => {
      let cells = (row || []).map(stripNo).filter(Boolean);
      if (!cells.length) return;
      if (cells.length === 1) {
        const { parts, extra } = splitInline(cells[0]);
        if (parts.length > 1 || extra) cells = parts.concat(extra ? [extra] : []);
      }
      // 칸 안의 이름들
      const holders = [];
      const rest = [];
      cells.forEach((c) => {
        const ns = findNames(c);
        const leftover = ns.reduce((t, n) => t.replace(n, ''), c).replace(/[\d,，/·\s번]+/g, '');
        if (ns.length && leftover.length <= 1) holders.push(...ns);
        else if (isName(c)) holders.push(c.replace(/^\d{1,2}\s*/, ''));
        else rest.push(c);
      });
      // 한 칸짜리 문장이면 앞 역할의 설명으로
      const sentenceOnly = rest.length === 1 && last && !last.desc && looksDesc(rest[0]);
      const roleIdx = sentenceOnly ? -1 : rest.findIndex(roleLike);
      if (roleIdx >= 0) {
        const r = getRole(rest[roleIdx]);
        const desc = rest.filter((c, i) => i !== roleIdx && c.length >= 4 && !HEADER_WORDS.test(c) && !/^\d+\s*(명|인)?$/.test(c))
          .sort((a, b) => b.length - a.length)[0];
        if (desc && !r.desc) r.desc = desc;
        const cnt = rest.find((c) => /^\d\s*(명|인)$/.test(c));
        if (cnt) r.count = parseInt(cnt, 10);
        holders.forEach((h) => r.holders.includes(h) || r.holders.push(h));
        last = r;
      } else if (last) {
        // 역할명이 없는 줄: 앞 역할에 이름/설명 덧붙이기 (한글 표가 문단으로 풀린 경우)
        holders.forEach((h) => last.holders.includes(h) || last.holders.push(h));
        const desc = rest.filter((c) => c.length >= 6 && !HEADER_WORDS.test(c)).sort((a, b) => b.length - a.length)[0];
        if (desc && !last.desc) last.desc = desc;
      }
    });
    return roles.filter((r) => r.name).map((r) => ({ ...r, count: r.count || Math.max(1, r.holders.length) }));
  }

  /* ---------------- 파일 → 행(rows) 추출 ---------------- */
  // HWP 5.0 레코드 스트림(압축 해제 후)에서 문단/표 텍스트 추출
  function hwpRecordsToRows(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const rows = []; const stack = [];
    const TBL = 0x74626c20; // 'tbl '
    const flush = () => {
      const t = stack.pop();
      const rs = [...t.cells.keys()].sort((a, b) => a - b);
      const out = rs.map((r) => { const m = t.cells.get(r); return [...m.keys()].sort((a, b) => a - b).map((c) => clean(m.get(c))); });
      if (stack.length && stack[stack.length - 1].cur) {
        // 표 안의 표: 바깥 칸에 텍스트로 이어붙임
        const o = stack[stack.length - 1];
        out.forEach((r) => appendCell(o, r.join(' ')));
      } else out.forEach((r) => rows.push(r));
    };
    const appendCell = (t, txt) => {
      const { r, c } = t.cur; if (!t.cells.has(r)) t.cells.set(r, new Map());
      const m = t.cells.get(r); m.set(c, (m.get(c) ? m.get(c) + ' ' : '') + txt);
    };
    let p = 0;
    while (p + 4 <= u8.length) {
      const h = dv.getUint32(p, true); p += 4;
      const tag = h & 0x3ff, level = (h >>> 10) & 0x3ff; let size = (h >>> 20) & 0xfff;
      if (size === 0xfff) { size = dv.getUint32(p, true); p += 4; }
      const start = p; p += size; if (p > u8.length) break;
      while (stack.length && level <= stack[stack.length - 1].level) flush();
      if (tag === 71 && size >= 4 && dv.getUint32(start, true) === TBL) {
        stack.push({ level, cells: new Map(), cur: null });
      } else if (tag === 72 && stack.length && level === stack[stack.length - 1].level + 1 && size >= 12) {
        stack[stack.length - 1].cur = { c: dv.getUint16(start + 8, true), r: dv.getUint16(start + 10, true) };
      } else if (tag === 67) {
        const txt = hwpText(u8, start, size);
        if (!txt) continue;
        const top = stack[stack.length - 1];
        if (top && top.cur) appendCell(top, txt);
        else txt.split('\n').forEach((l) => clean(l) && rows.push([clean(l)]));
      }
    }
    while (stack.length) flush();
    return rows;
  }
  function hwpText(u8, start, size) {
    let s = ''; const end = start + size;
    for (let i = start; i + 1 < end;) {
      const c = u8[i] | (u8[i + 1] << 8);
      if (c < 32) {
        if (c === 10 || c === 13) { s += '\n'; i += 2; }
        else if (c === 0 || (c >= 24 && c <= 31)) i += 2;
        else i += 16; // 인라인/확장 컨트롤: 8 WCHAR
      } else { s += String.fromCharCode(c); i += 2; }
    }
    return s.replace(/\n+$/, '');
  }

  // HWPX(section*.xml 문자열 + DOMParser) → rows
  function hwpxXmlToRows(xml, DOMParserImpl) {
    const doc = new DOMParserImpl().parseFromString(xml, 'application/xml');
    const rows = [];
    const textOf = (el, skipTbl) => {
      let s = '';
      const walk = (n) => {
        for (const ch of Array.from(n.childNodes || [])) {
          if (ch.nodeType !== 1) continue;
          const ln = ch.localName;
          if (skipTbl && ln === 'tbl') continue;
          if (ln === 't') s += ch.textContent;
          else if (ln === 'lineBreak') s += ' ';
          else walk(ch);
        }
      };
      walk(el); return clean(s);
    };
    const walk = (n) => {
      for (const ch of Array.from(n.childNodes || [])) {
        if (ch.nodeType !== 1) continue;
        if (ch.localName === 'tbl') {
          const trs = Array.from(ch.getElementsByTagNameNS('*', 'tr')).filter((tr) => closestTbl(tr) === ch);
          trs.forEach((tr) => {
            const tcs = Array.from(tr.childNodes).filter((x) => x.nodeType === 1 && x.localName === 'tc');
            rows.push(tcs.map((tc) => textOf(tc, false)));
          });
        } else if (ch.localName === 'p') {
          const t = textOf(ch, true); if (t) rows.push([t]);
          walk(ch); // 문단 안의 표 찾기
        } else walk(ch);
      }
    };
    const closestTbl = (el) => { let p = el.parentNode; while (p && p.localName !== 'tbl') p = p.parentNode; return p; };
    walk(doc.documentElement);
    // walk가 p의 텍스트와 p 내부의 표를 따로 넣으므로 중복은 없음
    return rows;
  }

  // PDF.js textContent.items → rows (같은 높이 = 한 줄, 큰 간격 = 칸 구분)
  function pdfItemsToRows(items) {
    const lines = [];
    items.filter((it) => clean(it.str)).forEach((it) => {
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
      let line = lines.find((l) => Math.abs(l.y - y) < h * 0.5);
      if (!line) { line = { y, h, items: [] }; lines.push(line); }
      line.items.push({ x, w: it.width || 0, s: it.str });
    });
    lines.sort((a, b) => b.y - a.y);
    return lines.map((l) => {
      l.items.sort((a, b) => a.x - b.x);
      const cells = []; let cur = null, endX = -1e9;
      l.items.forEach((it) => {
        if (cur != null && it.x - endX > l.h * 2.2) { cells.push(cur); cur = null; }
        cur = cur == null ? it.s : cur + (it.x - endX > l.h * 0.2 ? ' ' : '') + it.s;
        endX = it.x + it.w;
      });
      if (cur != null) cells.push(cur);
      return cells.map(clean).filter(Boolean);
    }).filter((r) => r.length);
  }

  // 일반 텍스트 → rows (탭은 칸 구분)
  function textToRows(text) {
    return String(text || '').split(/\r?\n/).map((l) => l.split(/\t+/).map(clean).filter(Boolean)).filter((r) => r.length);
  }

  /* ---------------- 확인코드 ---------------- */
  function makePin() { return String(Math.floor(1000 + Math.random() * 9000)); }

  const Core = {
    clean, uid, shuffle, MCMF, assignRoles, statsOf, isForbidden, normRole, tallyPeer, validateVote,
    normGender, parseRosterRows, parseRosterText, extractRolesFromRows,
    hwpRecordsToRows, hwpText, hwpxXmlToRows, pdfItemsToRows, textToRows, makePin,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
