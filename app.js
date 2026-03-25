// app.js - Dashboard with admin + staff views (async Supabase)

document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.requireAuth()) return;

  let issueHistoryCache = [];
  const TOTAL_STEPS = 6;
  function $(id) { return document.getElementById(id); }

  const user = Auth.getUser();
  if (!user) return;

  // Fix stale session — look up from source of truth
  if (!user.hoOrCo) {
    const knownUser = await Auth.getUserById(user.id);
    user.hoOrCo = knownUser ? knownUser.hoOrCo : 'CO';
    localStorage.setItem('nlpl_auth_user', JSON.stringify(user));
  }

  // Load branches and employees from DB
  await loadBranches();
  await loadEmployees();

  const isAdmin = user.role === 'admin';

  // ─── COMMON DOM ──────────────────────────────────────────────────────────────
  const sidebar = $('sidebar'), sidebarToggle = $('sidebarToggle'), sidebarBackdrop = $('sidebarBackdrop');
  const mobileMenuBtn = $('mobileMenuBtn'), logoutBtn = $('logoutBtn'), toastContainer = $('toastContainer');

  $('userName').textContent = user.name;
  $('userRole').textContent = isAdmin ? 'Administrator' : user.role;
  $('userAvatar').textContent = user.name.charAt(0).toUpperCase();
  $('userHoCo').textContent = user.hoOrCo === 'HO' ? 'Head Office' : 'Branch Office';

  if (isAdmin) {
    $('topbarTitle').textContent = 'Admin Dashboard';
    $('topbarSubtitle').textContent = 'NLPL — Staff & Task Management';
  }

  // Sidebar toggle
  sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  mobileMenuBtn.addEventListener('click', () => { sidebar.classList.toggle('mobile-open'); sidebarBackdrop.classList.toggle('show'); });
  sidebarBackdrop.addEventListener('click', () => { sidebar.classList.remove('mobile-open'); sidebarBackdrop.classList.remove('show'); });
  logoutBtn.addEventListener('click', () => { if (confirm('Log out?')) Auth.logout(); });

  // ═══════════════════════════════════════════════════════════════════════════════
  // ADMIN VIEW
  // ═══════════════════════════════════════════════════════════════════════════════
  if (isAdmin) {
    $('staffNav').classList.add('hidden');
    $('adminNav').classList.remove('hidden');
    $('staffView').classList.add('hidden');
    $('adminView').classList.remove('hidden');
    $('fab').classList.add('hidden');

    let adminTab = 'overview';

    // Cache staff users
    const allUsers = await Auth.getUsers();
    const staffUsers = allUsers.filter(u => u.role === 'staff');

    // Admin nav — event delegation for reliability
    $('adminNav').addEventListener('click', async (e) => {
      const item = e.target.closest('[data-admin-tab]');
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('[data-admin-tab]').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      adminTab = item.dataset.adminTab;
      $('adminOverview').classList.toggle('hidden', adminTab !== 'overview');
      $('adminReports').classList.toggle('hidden', adminTab !== 'reports');
      $('adminDuration').classList.toggle('hidden', adminTab !== 'duration');
      if (adminTab === 'reports') await renderReport();
      if (adminTab === 'duration') await renderDuration();
      sidebar.classList.remove('mobile-open'); sidebarBackdrop.classList.remove('show');
    });

    async function getTasksByUser(userId) {
      const allTasks = await DataStore.getAll();
      const u = allUsers.find(x => x.id === userId);
      return u ? allTasks.filter(t => t.createdBy === u.name) : [];
    }

    async function renderAdminOverview() {
      const allTasks = await DataStore.getAll();
      const stats = await DataStore.getStats();

      // Top stat cards
      $('adminStatsGrid').innerHTML = `
        <div class="stat-card accent-blue"><div class="stat-icon blue">📋</div><div><div class="stat-num">${stats.total}</div><div class="stat-label">Total Tasks</div></div></div>
        <div class="stat-card accent-orange"><div class="stat-icon orange">⏳</div><div><div class="stat-num">${stats.inProgress}</div><div class="stat-label">In Progress</div></div></div>
        <div class="stat-card accent-green"><div class="stat-icon green">✅</div><div><div class="stat-num">${stats.completed}</div><div class="stat-label">Completed</div></div></div>
        <div class="stat-card accent-cyan"><div class="stat-icon cyan">👥</div><div><div class="stat-num">${staffUsers.length}</div><div class="stat-label">Staff Members</div></div></div>
      `;

      // User cards
      const userCardsHtml = [];
      for (const u of staffUsers) {
        const tasks = allTasks.filter(t => t.createdBy === u.name);
        const ip = tasks.filter(t => !t.completed).length;
        const done = tasks.filter(t => t.completed).length;
        const hoco = u.hoOrCo || '—';
        const avatarColors = ['#7c3aed', '#2563eb', '#0891b2', '#d97706', '#dc2626'];
        const color = avatarColors[u.id.charCodeAt(u.id.length - 1) % avatarColors.length];

        userCardsHtml.push(`
          <div class="admin-user-card" data-user-id="${u.id}">
            <div class="admin-user-card-header">
              <div class="user-avatar" style="background:${color}">${u.name.charAt(0)}</div>
              <div>
                <div class="admin-user-card-name">${esc(u.name)}</div>
                <div class="admin-user-card-id">${esc(u.id)}</div>
                <div class="admin-user-card-hoco"><span class="badge ${hoco === 'HO' ? 'badge-danger' : 'badge-success'}">${hoco}</span></div>
              </div>
            </div>
            <div class="admin-user-card-stats">
              <div class="admin-user-stat">
                <div class="admin-user-stat-num orange">${ip}</div>
                <div class="admin-user-stat-label">In Progress</div>
              </div>
              <div class="admin-user-stat">
                <div class="admin-user-stat-num green">${done}</div>
                <div class="admin-user-stat-label">Completed</div>
              </div>
            </div>
          </div>`);
      }
      $('adminUserGrid').innerHTML = userCardsHtml.join('');

      // Click user card → go to reports filtered by that user
      $('adminUserGrid').querySelectorAll('[data-user-id]').forEach(card => {
        card.addEventListener('click', async () => {
          selectedStaffId = card.dataset.userId;
          document.querySelectorAll('[data-admin-tab]').forEach(n => n.classList.remove('active'));
          document.querySelector('[data-admin-tab="reports"]').classList.add('active');
          $('adminOverview').classList.add('hidden');
          $('adminReports').classList.remove('hidden');
          $('staffSelector').innerHTML = '';
          await renderStaffSelector();
          await renderReport();
        });
      });

      // Sidebar stats
      $('adminSidebarStats').innerHTML = `
        <div class="admin-sidebar-stat-row"><span>Total</span><span class="admin-sidebar-stat-val">${stats.total}</span></div>
        <div class="admin-sidebar-stat-row"><span>⏳ In Progress</span><span class="admin-sidebar-stat-val">${stats.inProgress}</span></div>
        <div class="admin-sidebar-stat-row"><span>✅ Completed</span><span class="admin-sidebar-stat-val">${stats.completed}</span></div>
        <div class="admin-sidebar-stat-row"><span>🖥️ Software</span><span class="admin-sidebar-stat-val">${stats.software}</span></div>
        <div class="admin-sidebar-stat-row"><span>🔧 Hardware</span><span class="admin-sidebar-stat-val">${stats.hardware}</span></div>
      `;
    }

    // ─── REPORTS ──────────────────────────────────────────────────────────────
    let selectedStaffId = '';
    const colFilters = { date: '', branch: '', issueType: '' };

    async function renderStaffSelector() {
      const allTasks = await DataStore.getAll();
      const avatarColors = ['#7c3aed', '#2563eb', '#0891b2', '#d97706', '#dc2626'];

      const allCard = document.createElement('div');
      allCard.className = 'staff-select-card' + (selectedStaffId === '' ? ' selected' : '');
      allCard.dataset.staffId = '';
      allCard.innerHTML = `
        <div class="staff-card-avatar" style="background:#64748b">★</div>
        <div class="staff-card-name">All Staff</div>
        <div class="staff-card-id">Everyone</div>
        <div class="staff-card-count">${allTasks.length} tasks</div>`;
      $('staffSelector').appendChild(allCard);

      staffUsers.forEach(u => {
        const color = avatarColors[u.id.charCodeAt(u.id.length - 1) % avatarColors.length];
        const userTasks = allTasks.filter(t => t.createdBy === u.name);
        const card = document.createElement('div');
        card.className = 'staff-select-card' + (selectedStaffId === u.id ? ' selected' : '');
        card.dataset.staffId = u.id;
        card.innerHTML = `
          <div class="staff-card-avatar" style="background:${color}">${u.name.charAt(0)}</div>
          <div class="staff-card-name">${esc(u.name)}</div>
          <div class="staff-card-id">${esc(u.id)}</div>
          <div class="staff-card-count">${userTasks.length} tasks</div>`;
        $('staffSelector').appendChild(card);
      });

      $('staffSelector').querySelectorAll('.staff-select-card').forEach(card => {
        card.addEventListener('click', async () => {
          selectedStaffId = card.dataset.staffId;
          $('staffSelector').querySelectorAll('.staff-select-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          await renderReport();
        });
      });
    }

    $('rptExport').addEventListener('click', async () => {
      let tasks = await DataStore.getAll();
      if (selectedStaffId) {
        const u = allUsers.find(x => x.id === selectedStaffId);
        if (u) tasks = tasks.filter(t => t.createdBy === u.name);
      }
      if (colFilters.date) tasks = tasks.filter(t => t.timestamp && t.timestamp.split(' ')[0] === colFilters.date);
      if (colFilters.branch) tasks = tasks.filter(t => t.branch === colFilters.branch);
      if (colFilters.issueType) tasks = tasks.filter(t => t.issueType === colFilters.issueType);

      const headers = ['Task ID', 'Date', 'Created By', 'Branch', 'HO/CO', 'Issue Type', 'Issue Description', 'Status', 'Amount'];
      const rows = tasks.map(t => [
        t.taskId,
        t.timestamp ? t.timestamp.split(' ')[0] : '',
        t.createdBy,
        t.branch,
        t.hoOrCo,
        t.issueType,
        '"' + (t.issueDescription || '').replace(/"/g, '""') + '"',
        t.completed ? 'Completed' : 'In Progress',
        t.amount || 0
      ].join(','));
      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'nlpl_report_' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click(); URL.revokeObjectURL(url);
    });

    // Report table column header filters
    document.querySelectorAll('.th-filterable[data-rptcol]').forEach(th => {
      th.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeColFilterPopup();
        const col = th.dataset.rptcol;
        const allTasks = await DataStore.getAll();
        let vals;
        if (col === 'date') vals = [...new Set(allTasks.map(t => t.timestamp ? t.timestamp.split(' ')[0] : '').filter(Boolean))].sort().reverse();
        else if (col === 'branch') vals = [...new Set(allTasks.map(t => t.branch).filter(Boolean))].sort();
        else if (col === 'issueType') vals = [...new Set(allTasks.map(t => t.issueType).filter(Boolean))].sort();
        else return;
        if (!vals.length) return;

        const rect = th.getBoundingClientRect();
        const currentVal = colFilters[col];

        const popup = document.createElement('div');
        popup.className = 'col-filter-popup'; popup.id = 'colFilterPopup';
        popup.style.top = (rect.bottom + 4) + 'px';
        popup.style.left = Math.min(rect.left, window.innerWidth - 220) + 'px';

        const labels = { date: 'Date', branch: 'Branch', issueType: 'Issue Type' };
        popup.innerHTML = `
          <div class="col-filter-header"><span>Filter: ${labels[col]}</span><button class="popup-close">✕</button></div>
          <div class="col-filter-list">
            <div class="col-filter-item" data-val=""><span class="check-mark">${!currentVal ? '✓' : ''}</span><span>Show All</span></div>
            ${vals.map(v => `<div class="col-filter-item ${currentVal === v ? 'selected' : ''}" data-val="${esc(v)}"><span class="check-mark">${currentVal === v ? '✓' : ''}</span><span>${esc(v)}</span></div>`).join('')}
          </div>`;
        document.body.appendChild(popup);
        popup.querySelector('.popup-close').addEventListener('click', closeColFilterPopup);
        popup.querySelectorAll('.col-filter-item').forEach(item => {
          item.addEventListener('click', async () => {
            colFilters[col] = item.dataset.val;
            closeColFilterPopup();
            await renderReport();
          });
        });
      });
    });

    async function renderReport() {
      let tasks = await DataStore.getAll();

      // Filter by selected staff
      if (selectedStaffId) {
        const u = allUsers.find(x => x.id === selectedStaffId);
        if (u) tasks = tasks.filter(t => t.createdBy === u.name);
      }
      // Column header filters
      if (colFilters.date) tasks = tasks.filter(t => t.timestamp && t.timestamp.split(' ')[0] === colFilters.date);
      if (colFilters.branch) tasks = tasks.filter(t => t.branch === colFilters.branch);
      if (colFilters.issueType) tasks = tasks.filter(t => t.issueType === colFilters.issueType);

      const ip = tasks.filter(t => !t.completed).length;
      const done = tasks.filter(t => t.completed).length;
      const totalAmt = tasks.reduce((s, t) => s + (t.amount || 0), 0);

      $('reportSummary').innerHTML = `
        <div class="report-summary-card"><div class="report-summary-num">${tasks.length}</div><div class="report-summary-label">Total</div></div>
        <div class="report-summary-card"><div class="report-summary-num" style="color:var(--warning)">${ip}</div><div class="report-summary-label">In Progress</div></div>
        <div class="report-summary-card"><div class="report-summary-num" style="color:var(--success)">${done}</div><div class="report-summary-label">Completed</div></div>
        <div class="report-summary-card"><div class="report-summary-num" style="color:var(--primary)">₹${totalAmt.toLocaleString('en-IN')}</div><div class="report-summary-label">Total Amount</div></div>
      `;

      if (tasks.length === 0) {
        $('reportTableBody').innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-muted)">No tasks match your filters.</td></tr>';
        return;
      }

      $('reportTableBody').innerHTML = tasks.map(t => {
        const typeCls = { Software: 'badge-primary', Hardware: 'badge-warning', Both: 'badge-info' }[t.issueType] || 'badge-gray';
        const hocoCls = t.hoOrCo === 'HO' ? 'badge-danger' : 'badge-success';
        const statusCls = t.completed ? 'badge-success' : 'badge-warning';
        const statusTxt = t.completed ? '✅ Done' : '⏳ Active';
        return `<tr data-rptview="${t.taskId}">
          <td class="task-id-cell">${esc(t.taskId)}</td>
          <td>${esc(t.timestamp ? t.timestamp.split(' ')[0] : '')}</td>
          <td>${esc(t.createdBy)}</td>
          <td>${esc(t.branch)}</td>
          <td><span class="badge ${hocoCls}">${esc(t.hoOrCo)}</span></td>
          <td><span class="badge ${typeCls}">${esc(t.issueType)}</span></td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.issueDescription)}</td>
          <td><span class="badge ${statusCls}">${statusTxt}</span></td>
          <td>₹${(t.amount || 0).toLocaleString('en-IN')}</td>
        </tr>`;
      }).join('');

      $('reportTableBody').querySelectorAll('[data-rptview]').forEach(row => {
        row.addEventListener('click', () => openViewSummary(row.dataset.rptview));
      });
    }

    // ─── DURATION ──────────────────────────────────────────────────────────────
    function calcDurationMs(start, end) {
      if (!start || !end) return null;
      const s = new Date(start), e = new Date(end);
      if (isNaN(s) || isNaN(e)) return null;
      return e - s;
    }

    function formatDuration(ms) {
      if (ms == null || ms < 0) return '—';
      const mins = Math.floor(ms / 60000);
      if (mins < 60) return `${mins}m`;
      const hrs = Math.floor(mins / 60);
      const remMins = mins % 60;
      if (hrs < 24) return `${hrs}h ${remMins}m`;
      const days = Math.floor(hrs / 24);
      const remHrs = hrs % 24;
      return `${days}d ${remHrs}h`;
    }

    // Canvas: draw smooth area chart with orange gradient + glow
    function drawAreaChart(canvasId, labels, values, unit) {
      const canvas = $(canvasId);
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement.getBoundingClientRect();
      const W = rect.width - 36; // account for panel padding
      const H = canvas.height;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      if (!values.length) {
        ctx.fillStyle = '#475569';
        ctx.font = '13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No data yet', W / 2, H / 2);
        return;
      }

      const padL = 40, padR = 16, padT = 20, padB = 30;
      const cW = W - padL - padR, cH = H - padT - padB;
      const maxVal = Math.max(...values, 1);
      const n = values.length;

      // Grid lines
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padT + (cH / 4) * i;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      }

      // Y-axis labels
      ctx.fillStyle = '#475569';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'right';
      for (let i = 0; i <= 4; i++) {
        const v = maxVal - (maxVal / 4) * i;
        const y = padT + (cH / 4) * i;
        let label = unit === 'time' ? formatDuration(v) : String(Math.round(v));
        ctx.fillText(label, padL - 6, y + 4);
      }

      // Build points
      const pts = values.map((v, i) => ({
        x: padL + (n === 1 ? cW / 2 : (i / (n - 1)) * cW),
        y: padT + cH - (v / maxVal) * cH
      }));

      // Smooth curve helper (catmull-rom → bezier)
      function smoothPath(ctx, pts) {
        if (pts.length < 2) return;
        ctx.moveTo(pts[0].x, pts[0].y);
        if (pts.length === 2) { ctx.lineTo(pts[1].x, pts[1].y); return; }
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[i === 0 ? 0 : i - 1];
          const p1 = pts[i], p2 = pts[i + 1];
          const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];
          const cp1x = p1.x + (p2.x - p0.x) / 6;
          const cp1y = p1.y + (p2.y - p0.y) / 6;
          const cp2x = p2.x - (p3.x - p1.x) / 6;
          const cp2y = p2.y - (p3.y - p1.y) / 6;
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
      }

      // Area fill with gradient
      const grad = ctx.createLinearGradient(0, padT, 0, padT + cH);
      grad.addColorStop(0, 'rgba(245,158,11,0.45)');
      grad.addColorStop(0.5, 'rgba(217,119,6,0.15)');
      grad.addColorStop(1, 'rgba(217,119,6,0)');

      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.lineTo(pts[pts.length - 1].x, padT + cH);
      ctx.lineTo(pts[0].x, padT + cH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Glow line
      ctx.save();
      ctx.shadowColor = 'rgba(245,158,11,0.6)';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();

      // Dots + value labels
      pts.forEach((p, i) => {
        // Dot glow
        ctx.save();
        ctx.shadowColor = 'rgba(251,191,36,0.7)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
        ctx.restore();

        // Vertical dashed line
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(245,158,11,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y + 6); ctx.lineTo(p.x, padT + cH); ctx.stroke();
        ctx.setLineDash([]);

        // Value label
        let valTxt = unit === 'time' ? formatDuration(values[i]) : String(values[i]);
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(valTxt, p.x, p.y - 10);
      });

      // X-axis labels
      ctx.fillStyle = '#64748b';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      pts.forEach((p, i) => {
        let lbl = labels[i] || '';
        if (lbl.length > 8) lbl = lbl.slice(0, 7) + '…';
        ctx.fillText(lbl, p.x, padT + cH + 18);
      });
    }

    async function renderDuration() {
      const allTasks = await DataStore.getAll();
      const completed = allTasks.filter(t => t.completed && t.timestamp && t.completedAt);

      // Group by staff
      const staffMap = {};
      completed.forEach(t => {
        const name = t.createdBy || 'Unknown';
        const dur = calcDurationMs(t.timestamp, t.completedAt);
        if (dur == null || dur < 0) return;
        if (!staffMap[name]) staffMap[name] = [];
        staffMap[name].push(dur);
      });

      const staffStats = Object.entries(staffMap).map(([name, durations]) => {
        const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
        const min = Math.min(...durations);
        const max = Math.max(...durations);
        return { name, count: durations.length, avg, min, max };
      }).sort((a, b) => a.avg - b.avg);

      // Summary
      const totalCompleted = completed.length;
      const allDurations = completed.map(t => calcDurationMs(t.timestamp, t.completedAt)).filter(d => d != null && d >= 0);
      const globalAvg = allDurations.length ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length : 0;
      const fastest = allDurations.length ? Math.min(...allDurations) : 0;
      const slowest = allDurations.length ? Math.max(...allDurations) : 0;

      $('durationSummary').innerHTML = `
        <div class="dur-stat-card"><div class="dur-stat-num" style="color:#f59e0b">${totalCompleted}</div><div class="dur-stat-label">Completed</div></div>
        <div class="dur-stat-card"><div class="dur-stat-num" style="color:#fbbf24">${formatDuration(globalAvg)}</div><div class="dur-stat-label">Avg Duration</div></div>
        <div class="dur-stat-card"><div class="dur-stat-num" style="color:#34d399">${formatDuration(fastest)}</div><div class="dur-stat-label">Fastest</div></div>
        <div class="dur-stat-card"><div class="dur-stat-num" style="color:#f87171">${formatDuration(slowest)}</div><div class="dur-stat-label">Slowest</div></div>
      `;

      // Area chart: completions per day
      const dayMap = {};
      completed.forEach(t => {
        const day = t.completedAt ? t.completedAt.split(' ')[0] : (t.timestamp ? t.timestamp.split(' ')[0] : null);
        if (!day) return;
        dayMap[day] = (dayMap[day] || 0) + 1;
      });
      const dayLabels = Object.keys(dayMap).sort();
      const dayValues = dayLabels.map(d => dayMap[d]);
      // Show short date labels
      const shortDayLabels = dayLabels.map(d => { const p = d.split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : d; });
      drawAreaChart('durAreaChart', shortDayLabels, dayValues, 'count');

      // Staff avg duration chart
      const staffLabels = staffStats.map(s => s.name.split(' ')[0]);
      const staffAvgs = staffStats.map(s => s.avg);
      drawAreaChart('durStaffChart', staffLabels, staffAvgs, 'time');

      // Glowing bars
      const maxAvg = staffStats.length ? Math.max(...staffStats.map(s => s.avg)) : 1;
      if (!staffStats.length) {
        $('durationBars').innerHTML = '<div style="text-align:center;padding:30px;color:#475569">No data yet</div>';
      } else {
        $('durationBars').innerHTML = staffStats.map((s, i) => {
          const pct = Math.max((s.avg / maxAvg) * 100, 5);
          return `<div class="dur-glow-row">
            <div class="dur-glow-rank">${i + 1}</div>
            <div class="dur-glow-name">${esc(s.name)}</div>
            <div class="dur-glow-track"><div class="dur-glow-fill" style="width:0%"></div></div>
            <div class="dur-glow-val">${formatDuration(s.avg)}</div>
          </div>`;
        }).join('');
        // Animate bars
        requestAnimationFrame(() => {
          $('durationBars').querySelectorAll('.dur-glow-fill').forEach((bar, i) => {
            const pct = Math.max((staffStats[i].avg / maxAvg) * 100, 5);
            setTimeout(() => { bar.style.width = pct + '%'; }, i * 80);
          });
        });
      }

      // Table
      if (!staffStats.length) {
        $('durationTableBody').innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:#475569">No data</td></tr>';
      } else {
        $('durationTableBody').innerHTML = staffStats.map((s, i) => `<tr>
          <td><span class="dur-dot" style="background:#f59e0b"></span>${esc(s.name)}</td>
          <td>${s.count}</td>
          <td style="color:#fbbf24"><strong>${formatDuration(s.avg)}</strong></td>
          <td style="color:#34d399">${formatDuration(s.min)}</td>
          <td style="color:#f87171">${formatDuration(s.max)}</td>
        </tr>`).join('');
      }
    }

    await renderAdminOverview();
    await renderStaffSelector();
    await renderReport();

    // Refresh periodically
    setInterval(async () => { await renderAdminOverview(); if (adminTab === 'reports') await renderReport(); if (adminTab === 'duration') await renderDuration(); }, 5000);

    // Shared view modal for admin
    function openViewSummary(taskId) { sharedOpenViewSummary(taskId); }

  } else {

  // ═══════════════════════════════════════════════════════════════════════════════
  // STAFF VIEW
  // ═══════════════════════════════════════════════════════════════════════════════

  const state = { currentTab: 'inprogress', editingTaskId: null, wizardStep: 1, selectedIssueTypes: [] };
  const taskGrid = $('taskGrid'), sectionTitle = $('sectionTitle'), fab = $('fab');
  const modalOverlay = $('modalOverlay'), modalTitle = $('modalTitle'), modalClose = $('modalClose');
  const stepperBar = $('stepperBar');
  const btnPrev = $('btnPrev'), btnNext = $('btnNext'), btnCancel = $('btnCancel'), btnSave = $('btnSave'), btnComplete = $('btnComplete');
  const fDate = $('fDate'), fTime = $('fTime'), fBranch = $('fBranch'), fHoCo = $('fHoCo');
  const staffSection = $('staffSection'), fStaffName = $('fStaffName'), fStaffId = $('fStaffId');
  const fIssueType = $('fIssueType'), fIssueDesc = $('fIssueDesc'), fSolution = $('fSolution');
  const fDetailedDesc = $('fDetailedDesc'), fAmount = $('fAmount');
  const issueAutocomplete = $('issueAutocomplete'), reviewSummary = $('reviewSummary');
  const boxSoftware = $('boxSoftware'), boxHardware = $('boxHardware');
  const completedFilters = $('completedFilters'), completedTableWrap = $('completedTableWrap'), completedTableBody = $('completedTableBody');
  const solutionWordCount = $('solutionWordCount'), descWordCount = $('descWordCount');

  var completedColFilters = {};
  var quickFilterType = null;

  fHoCo.value = user.hoOrCo;
  populateBranchDropdown();
  await renderAll();

  // NAV
  document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', async () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      state.currentTab = item.dataset.tab;
      quickFilterType = null;
      completedColFilters = {};
      document.querySelectorAll('.th-filterable').forEach(th => th.classList.remove('filtered'));
      await renderTasks();
      sidebar.classList.remove('mobile-open'); sidebarBackdrop.classList.remove('show');
    });
  });

  // Quick stats filter
  document.querySelectorAll('[data-quickfilter]').forEach(item => {
    item.addEventListener('click', async () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      state.currentTab = 'inprogress';
      quickFilterType = item.dataset.quickfilter;
      await renderTasks();
      sidebar.classList.remove('mobile-open'); sidebarBackdrop.classList.remove('show');
    });
  });

  // Branch → staff dropdown
  fBranch.addEventListener('change', () => {
    if (fBranch.value) {
      staffSection.classList.remove('hidden');
      populateStaffDropdown(fBranch.value);
    } else {
      staffSection.classList.add('hidden');
    }
  });

  function populateStaffDropdown(location) {
    const employees = getEmployeesByLocation(location);
    fStaffName.innerHTML = '<option value="">-- Select Staff --</option>';
    employees.forEach(e => {
      const o = document.createElement('option');
      o.value = e.name;
      o.textContent = `${e.name} (${e.emp_id})`;
      o.dataset.empId = e.emp_id;
      fStaffName.appendChild(o);
    });
    fStaffId.value = '';
  }

  fStaffName.addEventListener('change', () => {
    const selected = fStaffName.options[fStaffName.selectedIndex];
    fStaffId.value = selected && selected.dataset.empId ? selected.dataset.empId : '';
  });

  // Issue type boxes
  boxSoftware.addEventListener('click', () => toggleIssueBox('Software'));
  boxHardware.addEventListener('click', () => toggleIssueBox('Hardware'));
  function toggleIssueBox(type) {
    const idx = state.selectedIssueTypes.indexOf(type);
    if (idx >= 0) state.selectedIssueTypes.splice(idx, 1); else state.selectedIssueTypes.push(type);
    boxSoftware.classList.toggle('selected', state.selectedIssueTypes.includes('Software'));
    boxHardware.classList.toggle('selected', state.selectedIssueTypes.includes('Hardware'));
    if (state.selectedIssueTypes.length === 2) fIssueType.value = 'Both';
    else if (state.selectedIssueTypes.length === 1) fIssueType.value = state.selectedIssueTypes[0];
    else fIssueType.value = '';
  }

  // Autocomplete
  // Load issue history from DB into cache
  issueHistoryCache = await IssueHistory.get(user.id);

  fIssueDesc.addEventListener('input', () => {
    const val = fIssueDesc.value.trim().toLowerCase();
    if (!val) { issueAutocomplete.classList.add('hidden'); return; }
    const m = issueHistoryCache.filter(h => h.toLowerCase().includes(val));
    if (!m.length) { issueAutocomplete.classList.add('hidden'); return; }
    issueAutocomplete.innerHTML = m.slice(0, 8).map(x => `<div class="autocomplete-item">${esc(x)}</div>`).join('');
    issueAutocomplete.classList.remove('hidden');
    issueAutocomplete.querySelectorAll('.autocomplete-item').forEach(el => { el.addEventListener('click', () => { fIssueDesc.value = el.textContent; issueAutocomplete.classList.add('hidden'); }); });
  });
  fIssueDesc.addEventListener('blur', () => setTimeout(() => issueAutocomplete.classList.add('hidden'), 200));

  // Word counters
  function countWords(t) { t = (t || '').trim(); return t ? t.split(/\s+/).length : 0; }
  fSolution.addEventListener('input', () => { const w = countWords(fSolution.value); solutionWordCount.textContent = w; solutionWordCount.parentElement.style.color = w > 50 ? 'var(--danger)' : 'var(--text-muted)'; });
  fDetailedDesc.addEventListener('input', () => { const w = countWords(fDetailedDesc.value); descWordCount.textContent = w; descWordCount.parentElement.style.color = w === 0 ? 'var(--text-muted)' : (w >= 500 && w <= 1000 ? 'var(--success)' : 'var(--warning)'); });

  // Wizard
  fab.addEventListener('click', openAddWizard);
  modalClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
  btnNext.addEventListener('click', () => { if (validateStep(state.wizardStep)) goToStep(state.wizardStep + 1); });
  btnPrev.addEventListener('click', () => { if (state.wizardStep > 1) goToStep(state.wizardStep - 1); });
  stepperBar.querySelectorAll('.stepper-step').forEach(el => {
    el.addEventListener('click', () => {
      const t = parseInt(el.dataset.step);
      if (t < state.wizardStep) goToStep(t);
      else if (t > state.wizardStep) { for (let s = state.wizardStep; s < t; s++) { if (!validateStep(s)) return; } goToStep(t); }
    });
  });
  btnSave.addEventListener('click', handleSave);
  btnComplete.addEventListener('click', handleComplete);

  function openAddWizard() {
    state.editingTaskId = null; state.selectedIssueTypes = []; resetForm();
    const now = new Date(); fDate.value = now.toISOString().split('T')[0]; fTime.value = now.toTimeString().slice(0, 8);
    modalTitle.textContent = '➕ New Task'; goToStep(1); openModal();
  }
  async function openEditWizard(taskId) {
    const task = await DataStore.getById(taskId); if (!task) return;
    state.editingTaskId = taskId; resetForm();
    if (task.timestamp) { const p = task.timestamp.split(' '); if (p[0]) fDate.value = p[0]; if (p[1]) fTime.value = p[1]; }
    fBranch.value = task.branch || ''; fHoCo.value = user.hoOrCo || task.hoOrCo || '';
    fBranch.dispatchEvent(new Event('change'));
    fStaffName.value = task.staffName || ''; fStaffName.dispatchEvent(new Event('change'));
    state.selectedIssueTypes = task.issueType === 'Both' ? ['Software', 'Hardware'] : task.issueType ? [task.issueType] : [];
    boxSoftware.classList.toggle('selected', state.selectedIssueTypes.includes('Software'));
    boxHardware.classList.toggle('selected', state.selectedIssueTypes.includes('Hardware'));
    fIssueType.value = task.issueType || '';
    fIssueDesc.value = task.issueDescription || ''; fSolution.value = task.solution || '';
    fDetailedDesc.value = task.detailedDescription || ''; fAmount.value = task.amount ?? 0;
    fSolution.dispatchEvent(new Event('input')); fDetailedDesc.dispatchEvent(new Event('input'));
    modalTitle.textContent = '✏️ Edit Task'; setFormReadonly(false); goToStep(1); openModal();
  }
  function goToStep(step) {
    state.wizardStep = step;
    for (let i = 1; i <= TOTAL_STEPS; i++) { const el = $('step' + i); if (el) el.classList.toggle('hidden', i !== step); }
    stepperBar.querySelectorAll('.stepper-step').forEach(el => { const s = parseInt(el.dataset.step); el.classList.toggle('active', s === step); el.classList.toggle('done', s < step); });
    btnPrev.classList.toggle('hidden', step === 1); btnNext.classList.toggle('hidden', step === TOTAL_STEPS);
    btnSave.classList.toggle('hidden', step !== TOTAL_STEPS); btnComplete.classList.toggle('hidden', step !== TOTAL_STEPS);
    if (step === TOTAL_STEPS) buildReviewSummary();
  }
  function openModal() { modalOverlay.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeModal() { modalOverlay.classList.remove('open'); document.body.style.overflow = ''; }

  function validateStep(step) {
    clearAllErrors();
    if (step === 1) { let ok = true; if (!fBranch.value) { setErr('errBranch', 'Select a branch.'); ok = false; } if (fBranch.value && !fStaffName.value) { setErr('errStaffName', 'Select a staff member.'); ok = false; } return ok; }
    if (step === 2) { if (!fIssueType.value) { setErr('errIssueType', 'Select at least one.'); return false; } return true; }
    if (step === 3) { if (!fIssueDesc.value.trim()) { setErr('errIssueDesc', 'Required.'); return false; } return true; }
    if (step === 4) { if (!fSolution.value.trim()) { setErr('errSolution', 'Required.'); return false; } if (countWords(fSolution.value) > 50) { setErr('errSolution', 'Max 50 words.'); return false; } return true; }
    return true;
  }
  function setErr(id, msg) { const el = $(id); if (el) el.textContent = msg; }
  function clearAllErrors() { document.querySelectorAll('.form-error').forEach(el => el.textContent = ''); }

  function buildReviewSummary() {
    const amt = parseFloat(fAmount.value) || 0;
    const desc = fDetailedDesc.value.trim() ? `<div style="margin-top:10px"><div class="detail-label">Detailed Description</div><div class="detail-value" style="margin-top:3px;white-space:pre-wrap;max-height:150px;overflow-y:auto">${esc(fDetailedDesc.value)}</div></div>` : '';
    reviewSummary.innerHTML = `<div class="detail-grid">
      <div class="detail-field"><div class="detail-label">Date & Time</div><div class="detail-value">${esc(fDate.value)} ${esc(fTime.value)}</div></div>
      <div class="detail-field"><div class="detail-label">Branch</div><div class="detail-value">${esc(fBranch.value)}</div></div>
      <div class="detail-field"><div class="detail-label">HO / CO</div><div class="detail-value">${esc(fHoCo.value)}</div></div>
      ${fStaffName.value ? `<div class="detail-field"><div class="detail-label">Staff</div><div class="detail-value">${esc(fStaffName.value)} (${esc(fStaffId.value)})</div></div>` : ''}
      <div class="detail-field"><div class="detail-label">Issue Type</div><div class="detail-value">${esc(fIssueType.value)}</div></div>
      <div class="detail-field"><div class="detail-label">Amount</div><div class="detail-value">₹${amt.toLocaleString('en-IN')}</div></div>
    </div><div style="margin-top:10px"><div class="detail-label">Issue</div><div class="detail-value" style="margin-top:3px">${esc(fIssueDesc.value)}</div></div>
    <div style="margin-top:10px"><div class="detail-label">Solution</div><div class="detail-value" style="margin-top:3px">${esc(fSolution.value)}</div></div>${desc}`;
  }

  async function buildTaskFromForm() {
    const taskId = state.editingTaskId || await generateTaskId();
    return { taskId, timestamp: `${fDate.value} ${fTime.value}`, branch: fBranch.value, hoOrCo: fHoCo.value, staffName: fStaffName.value.trim(), staffId: fStaffId.value.trim(), issueType: fIssueType.value, issueDescription: fIssueDesc.value.trim(), solution: fSolution.value.trim(), detailedDescription: fDetailedDesc.value.trim(), amount: parseFloat(fAmount.value) || 0, completed: false, completedAt: null, createdBy: user.name };
  }
  async function handleSave() {
    const d = await buildTaskFromForm(); await IssueHistory.save(user.id, d.issueDescription); issueHistoryCache = await IssueHistory.get(user.id);
    try {
      if (state.editingTaskId) { await DataStore.update(state.editingTaskId, d); showToast('Updated.', 'success'); }
      else { await DataStore.add(d); showToast('Saved.', 'success'); }
    } catch (err) { showToast('Error: ' + err.message, 'error'); return; }
    closeModal(); await renderAll();
  }
  async function handleComplete() {
    showConfirm('✅ Complete Task', 'Mark as completed? Cannot be undone.', 'Complete', async () => {
      const d = await buildTaskFromForm(); d.completed = true; d.completedAt = formatDateTime(new Date()); await IssueHistory.save(user.id, d.issueDescription); issueHistoryCache = await IssueHistory.get(user.id);
      try {
        if (state.editingTaskId) await DataStore.update(state.editingTaskId, d); else await DataStore.add(d);
      } catch (err) { showToast('Error: ' + err.message, 'error'); return; }
      closeModal(); showToast('Completed!', 'success'); await renderAll();
    });
  }

  function resetForm() {
    [fDate, fTime, fBranch, fStaffName, fStaffId, fIssueType, fIssueDesc, fSolution, fDetailedDesc].forEach(el => { if (el) el.value = ''; });
    fHoCo.value = user.hoOrCo || 'CO'; fAmount.value = 0; staffSection.classList.add('hidden');
    boxSoftware.classList.remove('selected'); boxHardware.classList.remove('selected');
    state.selectedIssueTypes = []; clearAllErrors();
    if (solutionWordCount) solutionWordCount.textContent = '0'; if (descWordCount) descWordCount.textContent = '0';
    reviewSummary.innerHTML = '';
  }
  function setFormReadonly(ro) {
    [fDate, fTime, fBranch, fHoCo, fStaffName, fStaffId, fIssueDesc, fSolution, fDetailedDesc, fAmount].forEach(el => { if (el) el.disabled = ro; });
    boxSoftware.style.pointerEvents = ro ? 'none' : ''; boxHardware.style.pointerEvents = ro ? 'none' : '';
  }
  function populateBranchDropdown() {
    fBranch.innerHTML = '<option value="">-- Select Branch --</option>';
    BRANCHES.forEach(b => { const o = document.createElement('option'); o.value = b; o.textContent = b; fBranch.appendChild(o); });
  }

  async function renderAll() { await renderTasks(); await updateNavBadges(); }
  async function updateNavBadges() {
    const s = await DataStore.getStats();
    $('navBadgeInProgress').textContent = s.inProgress; $('navBadgeCompleted').textContent = s.completed;
    $('navBadgeSoftware').textContent = s.software; $('navBadgeHardware').textContent = s.hardware; $('navBadgeBoth').textContent = s.both;
  }

  // Completed table column header filters
  const activeFilterBar = $('activeFilterBar');

  document.querySelectorAll('.th-filterable[data-col]').forEach(th => {
    th.addEventListener('click', async (e) => {
      e.stopPropagation(); closeColFilterPopup();
      const col = th.dataset.col;
      const completed = await DataStore.search('', { status: 'completed' });
      let vals;
      if (col === 'date') vals = [...new Set(completed.map(t => t.timestamp ? t.timestamp.split(' ')[0] : '').filter(Boolean))].sort().reverse();
      else if (col === 'branch') vals = [...new Set(completed.map(t => t.branch).filter(Boolean))].sort();
      else if (col === 'hoOrCo') vals = [...new Set(completed.map(t => t.hoOrCo).filter(Boolean))];
      else if (col === 'issueType') vals = [...new Set(completed.map(t => t.issueType).filter(Boolean))];
      else return;
      if (!vals.length) return;

      const rect = th.getBoundingClientRect();
      const popup = document.createElement('div');
      popup.className = 'col-filter-popup'; popup.id = 'colFilterPopup';
      popup.style.top = (rect.bottom + 4) + 'px'; popup.style.left = Math.min(rect.left, window.innerWidth - 220) + 'px';
      const labels = { date: 'Date', branch: 'Branch', hoOrCo: 'HO/CO', issueType: 'Issue Type' };
      popup.innerHTML = `<div class="col-filter-header"><span>Filter: ${labels[col]}</span><button class="popup-close">✕</button></div>
        <div class="col-filter-list"><div class="col-filter-item" data-val=""><span class="check-mark">${!completedColFilters[col] ? '✓' : ''}</span><span>Show All</span></div>
        ${vals.map(v => `<div class="col-filter-item ${completedColFilters[col] === v ? 'selected' : ''}" data-val="${esc(v)}"><span class="check-mark">${completedColFilters[col] === v ? '✓' : ''}</span><span>${esc(v)}</span></div>`).join('')}</div>`;
      document.body.appendChild(popup);
      popup.querySelector('.popup-close').addEventListener('click', closeColFilterPopup);
      popup.querySelectorAll('.col-filter-item').forEach(item => {
        item.addEventListener('click', async () => {
          if (item.dataset.val) completedColFilters[col] = item.dataset.val; else delete completedColFilters[col];
          th.classList.toggle('filtered', !!item.dataset.val); closeColFilterPopup(); await renderCompletedTable(); renderActiveFilterBar();
        });
      });
    });
  });

  document.addEventListener('click', (e) => { const p = $('colFilterPopup'); if (p && !p.contains(e.target) && !e.target.closest('.th-filterable')) closeColFilterPopup(); });

  function renderActiveFilterBar() {
    const keys = Object.keys(completedColFilters);
    if (!keys.length) { activeFilterBar.innerHTML = ''; return; }
    const labels = { date: 'Date', branch: 'Branch', hoOrCo: 'HO/CO', issueType: 'Issue Type' };
    activeFilterBar.innerHTML = keys.map(k => `<span class="active-filter-tag">${labels[k]}: <strong>${esc(completedColFilters[k])}</strong> <span class="filter-remove" data-remove="${k}">✕</span></span>`).join('') + '<span class="clear-all-filters" id="clearAllFilters">Clear all</span>';
    activeFilterBar.querySelectorAll('.filter-remove').forEach(el => {
      el.addEventListener('click', async () => { delete completedColFilters[el.dataset.remove]; const th = document.querySelector(`.th-filterable[data-col="${el.dataset.remove}"]`); if (th) th.classList.remove('filtered'); await renderCompletedTable(); renderActiveFilterBar(); });
    });
    const c = $('clearAllFilters'); if (c) c.addEventListener('click', async () => { completedColFilters = {}; document.querySelectorAll('.th-filterable').forEach(th => th.classList.remove('filtered')); await renderCompletedTable(); renderActiveFilterBar(); });
  }

  async function renderCompletedTable() {
    let tasks = await DataStore.search('', { status: 'completed' });
    Object.keys(completedColFilters).forEach(col => { const v = completedColFilters[col]; tasks = tasks.filter(t => { if (col === 'branch') return t.branch === v; if (col === 'issueType') return t.issueType === v; if (col === 'hoOrCo') return t.hoOrCo === v; if (col === 'date') return t.timestamp && t.timestamp.startsWith(v); return true; }); });
    renderActiveFilterBar();
    document.querySelectorAll('.th-filterable[data-col]').forEach(th => th.classList.toggle('filtered', !!completedColFilters[th.dataset.col]));
    if (!tasks.length) { completedTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">No completed tasks.</td></tr>'; return; }
    completedTableBody.innerHTML = tasks.map(t => {
      const tc = { Software: 'badge-primary', Hardware: 'badge-warning', Both: 'badge-info' }[t.issueType] || 'badge-gray';
      const hc = t.hoOrCo === 'HO' ? 'badge-danger' : 'badge-success';
      return `<tr data-view="${t.taskId}"><td class="task-id-cell">${esc(t.taskId)}</td><td>${esc(t.timestamp ? t.timestamp.split(' ')[0] : '')}</td><td>${esc(t.branch)}</td><td><span class="badge ${hc}">${esc(t.hoOrCo)}</span></td><td><span class="badge ${tc}">${esc(t.issueType)}</span></td><td>${esc(t.issueDescription)}</td><td>₹${(t.amount || 0).toLocaleString('en-IN')}</td></tr>`;
    }).join('');
    completedTableBody.querySelectorAll('[data-view]').forEach(row => { row.addEventListener('click', () => sharedOpenViewSummary(row.dataset.view)); });
  }

  async function renderTasks() {
    const isCompleted = state.currentTab === 'completed';
    if (quickFilterType) {
      sectionTitle.textContent = `⏳ In Progress — ${quickFilterType}`;
    } else {
      sectionTitle.textContent = isCompleted ? '✅ Completed Tasks' : '⏳ Tasks In Progress';
    }
    taskGrid.classList.toggle('hidden', isCompleted); completedFilters.classList.toggle('hidden', !isCompleted); completedTableWrap.classList.toggle('hidden', !isCompleted);
    if (isCompleted) { await renderCompletedTable(); } else {
      let tasks = await DataStore.search('', { status: 'inprogress' });
      if (quickFilterType) tasks = tasks.filter(t => t.issueType === quickFilterType);
      if (!tasks.length) { taskGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><h3>No in-progress ${quickFilterType || ''} tasks</h3><p>Click + to add a task.</p></div>`; return; }
      taskGrid.innerHTML = tasks.map(renderTaskCard).join('');
      taskGrid.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditWizard(b.dataset.edit)));
      taskGrid.querySelectorAll('[data-complete]').forEach(b => b.addEventListener('click', () => handleQuickComplete(b.dataset.complete)));
    }
  }

  function renderTaskCard(task) {
    const tb = { Software: 'badge-primary', Hardware: 'badge-warning', Both: 'badge-info' }[task.issueType] || 'badge-gray';
    const hb = task.hoOrCo === 'HO' ? 'badge-danger' : 'badge-success';
    const staff = task.staffName ? `<div class="task-field"><span class="task-field-label">Staff</span><span class="task-field-value">${esc(task.staffName)} (${esc(task.staffId)})</span></div>` : '';
    return `<div class="task-card"><div class="task-status-bar"></div><div class="task-card-header"><div><div class="task-card-id">${esc(task.taskId)}</div><div class="task-card-badges" style="margin-top:5px"><span class="badge badge-warning">⏳ In Progress</span><span class="badge ${tb}">${esc(task.issueType)}</span><span class="badge ${hb}">${esc(task.hoOrCo)}</span></div></div></div><div class="task-card-body"><div class="task-field"><span class="task-field-label">Branch</span><span class="task-field-value">${esc(task.branch)}</span></div>${staff}<div class="task-field"><span class="task-field-label">Issue</span><span class="task-field-value truncate">${esc(task.issueDescription)}</span></div><div class="task-field"><span class="task-field-label">Solution</span><span class="task-field-value truncate">${esc(task.solution)}</span></div></div><div class="task-card-footer"><span class="task-timestamp">🕐 ${esc(task.timestamp)}</span><button class="btn btn-secondary btn-sm" data-edit="${task.taskId}">✏️ Edit</button><button class="btn btn-success btn-sm" data-complete="${task.taskId}">✅ Completed</button></div></div>`;
  }

  async function handleQuickComplete(taskId) {
    const task = await DataStore.getById(taskId); if (!task) return;
    showConfirm('✅ Complete', `Mark <strong>${task.taskId}</strong> as completed?`, 'Complete', async () => {
      await DataStore.update(taskId, { completed: true, completedAt: formatDateTime(new Date()) }); showToast('Completed!', 'success'); await renderAll();
    });
  }

  } // end staff view

  // ═══════════════════════════════════════════════════════════════════════════════
  // SHARED UTILS
  // ═══════════════════════════════════════════════════════════════════════════════
  // Keyboard: Escape closes modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('viewOverlay').classList.contains('open')) { $('viewOverlay').classList.remove('open'); document.body.style.overflow = ''; }
      else if ($('modalOverlay').classList.contains('open')) { $('modalOverlay').classList.remove('open'); document.body.style.overflow = ''; }
      const cf = document.querySelector('.confirm-overlay'); if (cf) cf.remove();
    }
  });

  const viewOverlay = $('viewOverlay'), viewClose = $('viewClose'), viewDone = $('viewDone'), viewBody = $('viewBody'), viewTitleEl = $('viewTitle');
  viewClose.addEventListener('click', closeViewModal);
  viewDone.addEventListener('click', closeViewModal);
  viewOverlay.addEventListener('click', e => { if (e.target === viewOverlay) closeViewModal(); });
  function closeViewModal() { viewOverlay.classList.remove('open'); document.body.style.overflow = ''; }

  async function sharedOpenViewSummary(taskId) {
    const t = await DataStore.getById(taskId); if (!t) return;
    viewTitleEl.textContent = '📄 ' + t.taskId;
    const staff = t.staffName ? `<div class="detail-field"><div class="detail-label">Staff</div><div class="detail-value">${esc(t.staffName)} (${esc(t.staffId)})</div></div>` : '';
    const desc = t.detailedDescription ? `<div style="margin-top:14px"><div class="detail-label">Detailed Description</div><div class="detail-value" style="margin-top:4px;white-space:pre-wrap;max-height:180px;overflow-y:auto">${esc(t.detailedDescription)}</div></div>` : '';
    viewBody.innerHTML = `<div class="review-summary"><div class="detail-grid">
      <div class="detail-field"><div class="detail-label">Task ID</div><div class="detail-value mono">${esc(t.taskId)}</div></div>
      <div class="detail-field"><div class="detail-label">Date & Time</div><div class="detail-value">${esc(t.timestamp)}</div></div>
      <div class="detail-field"><div class="detail-label">Branch</div><div class="detail-value">${esc(t.branch)}</div></div>
      <div class="detail-field"><div class="detail-label">HO / CO</div><div class="detail-value">${esc(t.hoOrCo)}</div></div>
      ${staff}
      <div class="detail-field"><div class="detail-label">Issue Type</div><div class="detail-value">${esc(t.issueType)}</div></div>
      <div class="detail-field"><div class="detail-label">Amount</div><div class="detail-value">₹${(t.amount || 0).toLocaleString('en-IN')}</div></div>
      <div class="detail-field"><div class="detail-label">Status</div><div class="detail-value">${t.completed ? '✅ Completed' : '⏳ In Progress'}</div></div>
      <div class="detail-field"><div class="detail-label">Created By</div><div class="detail-value">${esc(t.createdBy)}</div></div>
      ${t.completedAt ? `<div class="detail-field"><div class="detail-label">Completed At</div><div class="detail-value">${esc(t.completedAt)}</div></div>` : ''}
    </div><div style="margin-top:14px"><div class="detail-label">Issue Description</div><div class="detail-value" style="margin-top:4px">${esc(t.issueDescription)}</div></div>
    <div style="margin-top:14px"><div class="detail-label">Solution</div><div class="detail-value" style="margin-top:4px">${esc(t.solution)}</div></div>${desc}</div>`;
    viewOverlay.classList.add('open'); document.body.style.overflow = 'hidden';
  }

  function closeColFilterPopup() { const p = $('colFilterPopup'); if (p) p.remove(); }

  function esc(str) { if (!str && str !== 0) return ''; return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function showToast(message, type) {
    type = type || 'info';
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const t = document.createElement('div'); t.className = 'toast ' + type;
    t.innerHTML = '<span>' + (icons[type] || 'ℹ️') + '</span><span>' + esc(message) + '</span>';
    toastContainer.appendChild(t);
    setTimeout(() => { t.classList.add('toast-fadeout'); setTimeout(() => t.remove(), 320); }, 3000);
  }

  function showConfirm(title, message, label, onConfirm, isDanger) {
    const o = document.createElement('div'); o.className = 'confirm-overlay';
    o.innerHTML = `<div class="confirm-box"><div class="confirm-title">${esc(title)}</div><div class="confirm-message">${message}</div><div class="confirm-actions"><button class="btn btn-secondary" id="confirmCancel">Cancel</button><button class="btn ${isDanger ? 'btn-danger' : 'btn-success'}" id="confirmOk">${esc(label)}</button></div></div>`;
    document.body.appendChild(o);
    o.querySelector('#confirmCancel').addEventListener('click', () => o.remove());
    o.querySelector('#confirmOk').addEventListener('click', () => { o.remove(); onConfirm(); });
    o.addEventListener('click', e => { if (e.target === o) o.remove(); });
  }
});
