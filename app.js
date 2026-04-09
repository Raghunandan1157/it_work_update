// app.js - Dashboard with admin + staff views (async Supabase)

document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.requireAuth()) return;

  let issueHistoryCache = [];
  const TOTAL_STEPS = 6;
  function $(id) { return document.getElementById(id); }

  const user = Auth.getUser();
  if (!user) return;

  // Load branches, employees, and fix stale session — all in parallel
  const initPromises = [loadBranches(), loadEmployees(), loadNmsplBranches(), loadNmsplEmployees(), loadCustomStaff()];
  if (!user.hoOrCo) initPromises.push(Auth.getUserById(user.id).then(k => {
    user.hoOrCo = k ? k.hoOrCo : 'CO';
    localStorage.setItem('nlpl_auth_user', JSON.stringify(user));
  }));
  await Promise.all(initPromises);

  const isAdmin = user.role === 'admin';

  // ─── COMPANY SELECTOR STATE ───
  let selectedCompany = null;

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

  // ─── COMPANY SELECTOR ─────────────────────────────────────────────────────
  document.querySelectorAll('.company-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.company-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedCompany = btn.dataset.company;
      const err = $('companyError');
      if (err) err.classList.add('hidden');

      // Update branch dropdown in wizard based on selected company
      populateBranchDropdown();
      // Refresh the view if in staff mode (renderAll is scoped to staff view)
      if (typeof renderAll === 'function') renderAll();
    });
  });

  function populateBranchDropdown() {
    const branches = selectedCompany === 'NMSPL' ? NMSPL_BRANCHES : BRANCHES;
    const fBranch = $('fBranch');
    if (fBranch) {
      fBranch.innerHTML = '<option value="">-- Select Branch --</option>';
      branches.forEach(b => {
        const o = document.createElement('option');
        o.value = b;
        o.textContent = b;
        fBranch.appendChild(o);
      });
    }
  }

  function getActiveEmployeesByLocation(location) {
    return selectedCompany === 'NMSPL'
      ? getNmsplEmployeesByLocation(location)
      : getEmployeesByLocation(location);
  }

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
      $('adminApprovals').classList.toggle('hidden', adminTab !== 'approvals');
      $('adminReports').classList.toggle('hidden', adminTab !== 'reports');
      $('adminDuration').classList.toggle('hidden', adminTab !== 'duration');
      if (adminTab === 'approvals') await renderApprovals();
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
      const [allTasks, stats] = await Promise.all([DataStore.getAll(), DataStore.getStats()]);
      const pendingApprovals = allTasks.filter(t => t.amountStatus === 'pending').length;
      updateApprovalBadge(pendingApprovals);

      // Top stat cards (clickable)
      $('adminStatsGrid').innerHTML = `
        <div class="stat-card accent-blue clickable" data-goto="reports" data-status="all"><div class="stat-icon blue">📋</div><div><div class="stat-num">${stats.total}</div><div class="stat-label">Total Tasks</div></div></div>
        <div class="stat-card accent-orange clickable" data-goto="reports" data-status="inprogress"><div class="stat-icon orange">⏳</div><div><div class="stat-num">${stats.inProgress}</div><div class="stat-label">In Progress</div></div></div>
        <div class="stat-card accent-green clickable" data-goto="reports" data-status="completed"><div class="stat-icon green">✅</div><div><div class="stat-num">${stats.completed}</div><div class="stat-label">Completed</div></div></div>
        <div class="stat-card accent-amber clickable" data-goto="approvals"><div class="stat-icon amber">💰</div><div><div class="stat-num">${pendingApprovals}</div><div class="stat-label">Pending Approvals</div></div></div>
        <div class="stat-card accent-cyan"><div class="stat-icon cyan">👥</div><div><div class="stat-num">${staffUsers.length}</div><div class="stat-label">Staff Members</div></div></div>
      `;

      // Stat card click → go to reports/approvals with filter
      $('adminStatsGrid').querySelectorAll('[data-goto]').forEach(card => {
        card.addEventListener('click', async () => {
          const goto = card.dataset.goto;
          if (goto === 'approvals') {
            document.querySelectorAll('[data-admin-tab]').forEach(n => n.classList.remove('active'));
            document.querySelector('[data-admin-tab="approvals"]').classList.add('active');
            adminTab = 'approvals';
            $('adminOverview').classList.add('hidden');
            $('adminApprovals').classList.remove('hidden');
            $('adminReports').classList.add('hidden');
            $('adminDuration').classList.add('hidden');
            await renderApprovals();
            return;
          }
          reportStatusFilter = card.dataset.status;
          selectedStaffId = '';
          companyFilter = ''; colFilters.date = []; colFilters.branch = []; colFilters.issueType = []; colFilters.hoOrCo = [];
          document.querySelectorAll('.company-filter-btn').forEach(b => b.classList.toggle('active', !b.dataset.companyFilter));
          document.querySelectorAll('[data-admin-tab]').forEach(n => n.classList.remove('active'));
          document.querySelector('[data-admin-tab="reports"]').classList.add('active');
          adminTab = 'reports';
          $('adminOverview').classList.add('hidden');
          $('adminApprovals').classList.add('hidden');
          $('adminReports').classList.remove('hidden');
          $('adminDuration').classList.add('hidden');
          $('staffSelector').innerHTML = '';
          await renderStaffSelector();
          await renderReport();
        });
      });

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
          adminTab = 'reports';
          $('adminOverview').classList.add('hidden');
          $('adminApprovals').classList.add('hidden');
          $('adminReports').classList.remove('hidden');
          $('adminDuration').classList.add('hidden');
          $('staffSelector').innerHTML = '';
          await renderStaffSelector();
          await renderReport();
        });
      });

      // Sidebar stats (clickable)
      $('adminSidebarStats').innerHTML = `
        <div class="admin-sidebar-stat-row clickable" data-sidebar-status="all"><span>📋 Total</span><span class="admin-sidebar-stat-val">${stats.total}</span></div>
        <div class="admin-sidebar-stat-row clickable" data-sidebar-status="inprogress"><span>⏳ In Progress</span><span class="admin-sidebar-stat-val">${stats.inProgress}</span></div>
        <div class="admin-sidebar-stat-row clickable" data-sidebar-status="completed"><span>✅ Completed</span><span class="admin-sidebar-stat-val">${stats.completed}</span></div>
      `;
      $('adminSidebarStats').querySelectorAll('[data-sidebar-status]').forEach(row => {
        row.addEventListener('click', async () => {
          reportStatusFilter = row.dataset.sidebarStatus;
          selectedStaffId = '';
          companyFilter = ''; colFilters.date = []; colFilters.branch = []; colFilters.issueType = []; colFilters.hoOrCo = [];
          document.querySelectorAll('.company-filter-btn').forEach(b => b.classList.toggle('active', !b.dataset.companyFilter));
          document.querySelectorAll('[data-admin-tab]').forEach(n => n.classList.remove('active'));
          document.querySelector('[data-admin-tab="reports"]').classList.add('active');
          adminTab = 'reports';
          $('adminOverview').classList.add('hidden');
          $('adminApprovals').classList.add('hidden');
          $('adminReports').classList.remove('hidden');
          $('adminDuration').classList.add('hidden');
          $('staffSelector').innerHTML = '';
          await renderStaffSelector();
          await renderReport();
          sidebar.classList.remove('mobile-open'); sidebarBackdrop.classList.remove('show');
        });
      });
    }

    // ─── FINANCIAL OVERVIEW ────────────────────────────────────────────────────
    let finPeriodDays = 1;

    document.querySelectorAll('.fin-period-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.fin-period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        finPeriodDays = parseInt(btn.dataset.finPeriod);
        await renderFinancialOverview();
      });
    });

    // Click financial section → go to approvals
    $('finSection').addEventListener('click', async (e) => {
      if (e.target.closest('.fin-period-btn')) return; // don't hijack filter clicks
      document.querySelectorAll('[data-admin-tab]').forEach(n => n.classList.remove('active'));
      document.querySelector('[data-admin-tab="approvals"]').classList.add('active');
      adminTab = 'approvals';
      $('adminOverview').classList.add('hidden');
      $('adminApprovals').classList.remove('hidden');
      $('adminReports').classList.add('hidden');
      $('adminDuration').classList.add('hidden');
      await renderApprovals();
    });

    async function renderFinancialOverview() {
      const allTasks = await DataStore.getAll();

      // Filter by period
      const now = new Date();
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - finPeriodDays);
      cutoff.setHours(0, 0, 0, 0);

      const tasks = allTasks.filter(t => {
        if (!t.timestamp) return false;
        const d = new Date(t.timestamp);
        return d >= cutoff;
      });

      // Calculate totals
      const expectedTotal = tasks.reduce((s, t) => s + (t.expectedAmount || t.amount || 0), 0);
      const actualTotal = tasks.filter(t => t.amountStatus === 'approved' && t.actualAmount != null).reduce((s, t) => s + t.actualAmount, 0);
      const paidTotal = tasks.filter(t => t.amountStatus === 'approved' && t.actualAmount != null).reduce((s, t) => s + t.actualAmount, 0);

      $('finExpectedTotal').textContent = '₹' + expectedTotal.toLocaleString('en-IN');
      $('finActualTotal').textContent = '₹' + actualTotal.toLocaleString('en-IN');
      $('finPaidTotal').textContent = '₹' + paidTotal.toLocaleString('en-IN');

      // Build chart data — group by date
      const dateMap = {};
      tasks.forEach(t => {
        const dateStr = extractDate(t.timestamp);
        if (!dateStr) return;
        if (!dateMap[dateStr]) dateMap[dateStr] = { expected: 0, actual: 0, paid: 0 };
        dateMap[dateStr].expected += (t.expectedAmount || t.amount || 0);
        if (t.actualAmount != null) dateMap[dateStr].actual += t.actualAmount;
        if (t.amountStatus === 'approved' && t.actualAmount != null) dateMap[dateStr].paid += t.actualAmount;
      });

      const dates = Object.keys(dateMap).sort();
      const expectedVals = dates.map(d => dateMap[d].expected);
      const actualVals = dates.map(d => dateMap[d].actual);
      const paidVals = dates.map(d => dateMap[d].paid);
      const labels = dates.map(d => formatDateDMY(d));

      drawFinChart(labels, expectedVals, actualVals, paidVals);
    }

    function drawFinChart(labels, expected, actual, paid) {
      const container = $('finChartContainer');
      const canvas = $('finChart');
      if (!canvas || !container) return;

      const dpr = window.devicePixelRatio || 1;
      const W = container.clientWidth;
      const H = container.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // Empty state
      if (!labels.length) {
        ctx.fillStyle = '#94a3b8'; ctx.font = '500 13px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('No data for this period', W / 2, H / 2);
        return;
      }

      const padL = 56, padR = 16, padT = 16, padB = 44;
      const chartW = W - padL - padR;
      const chartH = H - padT - padB;
      const allVals = [...expected, ...actual, ...paid];
      const maxVal = Math.max(...allVals, 1) * 1.1; // 10% headroom
      const toY = v => padT + chartH - (v / maxVal) * chartH;

      const colors = { expected: '#3b82f6', actual: '#f59e0b', paid: '#16a34a' };

      // Y-axis grid lines
      const ySteps = 4;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let i = 0; i <= ySteps; i++) {
        const val = (maxVal * i / ySteps);
        const y = toY(val);
        ctx.strokeStyle = i === 0 ? '#cbd5e1' : '#f1f5f9'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        ctx.fillStyle = '#94a3b8'; ctx.font = '11px Inter, system-ui, sans-serif';
        const label = val >= 100000 ? '₹' + (val / 100000).toFixed(1) + 'L' : val >= 1000 ? '₹' + (val / 1000).toFixed(0) + 'k' : '₹' + Math.round(val);
        ctx.fillText(label, padL - 8, y);
      }

      // --- BARS for Expected (blue, rounded top) ---
      const barGroupW = chartW / labels.length;
      const barW = Math.max(8, Math.min(barGroupW * 0.45, 36));

      labels.forEach((lbl, i) => {
        const cx = padL + barGroupW * i + barGroupW / 2;
        const val = expected[i];
        if (val <= 0) return;
        const h = (val / maxVal) * chartH;
        const x = cx - barW / 2;
        const y = padT + chartH - h;
        const r = Math.min(5, barW / 3);

        // Bar with gradient
        const grad = ctx.createLinearGradient(x, y, x, padT + chartH);
        grad.addColorStop(0, 'rgba(59,130,246,0.85)');
        grad.addColorStop(1, 'rgba(59,130,246,0.35)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x, padT + chartH);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.lineTo(x + barW - r, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
        ctx.lineTo(x + barW, padT + chartH);
        ctx.closePath();
        ctx.fill();

        // X label
        ctx.fillStyle = '#64748b'; ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(lbl, cx, padT + chartH + 6);
      });

      // --- Smooth LINE helper ---
      function drawSmoothLine(data, color, dashed) {
        const pts = data.map((v, i) => ({
          x: padL + barGroupW * i + barGroupW / 2,
          y: toY(v)
        }));
        if (pts.length < 1) return;

        ctx.save();
        ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        if (dashed) ctx.setLineDash([6, 4]);
        ctx.beginPath();

        if (pts.length === 1) {
          // Single point — draw a dot
          ctx.arc(pts[0].x, pts[0].y, 4, 0, Math.PI * 2);
          ctx.fillStyle = color; ctx.fill();
          ctx.restore(); return;
        }

        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[Math.max(i - 1, 0)];
          const p1 = pts[i];
          const p2 = pts[i + 1];
          const p3 = pts[Math.min(i + 2, pts.length - 1)];
          const cp1x = p1.x + (p2.x - p0.x) / 6;
          const cp1y = p1.y + (p2.y - p0.y) / 6;
          const cp2x = p2.x - (p3.x - p1.x) / 6;
          const cp2y = p2.y - (p3.y - p1.y) / 6;
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
        ctx.stroke();

        // Dots at each point
        pts.forEach(p => {
          ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = '#fff'; ctx.fill();
          ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
        });
        ctx.restore();
      }

      // --- LINES for Actual (solid amber) and Paid (dashed green) ---
      drawSmoothLine(actual, colors.actual, false);
      drawSmoothLine(paid, colors.paid, true);

      // --- LEGEND (bottom) ---
      const legendY = H - 10;
      ctx.textBaseline = 'middle'; ctx.font = '11px Inter, system-ui, sans-serif';
      const items = [
        { label: 'Expected', color: colors.expected, type: 'bar' },
        { label: 'Actual', color: colors.actual, type: 'line' },
        { label: 'Paid', color: colors.paid, type: 'dash' }
      ];
      // center legend
      const totalW = items.reduce((s, it) => s + ctx.measureText(it.label).width + 30, 0);
      let lx = (W - totalW) / 2;
      items.forEach(it => {
        if (it.type === 'bar') {
          ctx.fillStyle = it.color;
          ctx.fillRect(lx, legendY - 5, 14, 10);
        } else {
          ctx.strokeStyle = it.color; ctx.lineWidth = 2.5;
          if (it.type === 'dash') ctx.setLineDash([4, 3]); else ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(lx, legendY); ctx.lineTo(lx + 14, legendY); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = '#475569'; ctx.textAlign = 'left';
        ctx.fillText(it.label, lx + 18, legendY);
        lx += ctx.measureText(it.label).width + 30;
      });
    }

    // ─── APPROVALS ─────────────────────────────────────────────────────────────
    let approvalFilter = 'pending';

    function updateApprovalBadge(count) {
      const badge = $('navBadgePendingApprovals');
      if (badge) { badge.textContent = count; badge.style.display = count > 0 ? '' : 'none'; }
    }

    document.querySelectorAll('.approval-tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.approval-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        approvalFilter = btn.dataset.approvalFilter;
        await renderApprovals();
      });
    });

    async function renderApprovals() {
      const allTasks = await DataStore.getAll();
      const tasks = allTasks.filter(t => t.amountStatus === approvalFilter);
      const pendingCount = allTasks.filter(t => t.amountStatus === 'pending').length;
      updateApprovalBadge(pendingCount);

      if (!tasks.length) {
        $('approvalsGrid').innerHTML = `<div class="empty-state" style="padding:40px"><div class="empty-icon">${approvalFilter === 'pending' ? '✅' : '📋'}</div><h3>No ${approvalFilter} approvals</h3><p>${approvalFilter === 'pending' ? 'All caught up! No tasks awaiting your approval.' : 'No tasks with this status.'}</p></div>`;
        return;
      }

      $('approvalsGrid').innerHTML = tasks.map(t => {
        const expected = (t.expectedAmount || 0);
        const actual = (t.actualAmount || 0);
        const diff = actual - expected;
        const diffClass = diff > 0 ? 'amt-over' : diff < 0 ? 'amt-under' : 'amt-equal';
        const diffText = diff > 0 ? `+₹${diff.toLocaleString('en-IN')}` : diff < 0 ? `-₹${Math.abs(diff).toLocaleString('en-IN')}` : 'No change';

        let actions = '';
        if (approvalFilter === 'pending') {
          actions = `<div class="approval-actions"><button class="btn btn-success btn-sm" data-approve="${t.taskId}">✅ Approve</button><button class="btn btn-danger btn-sm" data-reject="${t.taskId}">❌ Reject</button></div>`;
        } else if (approvalFilter === 'approved') {
          actions = `<div class="approval-meta">Approved by ${esc(t.amountReviewedBy || '—')}${t.amountReviewedAt ? ' on ' + esc(t.amountReviewedAt) : ''}</div>`;
        } else if (approvalFilter === 'rejected') {
          actions = `<div class="approval-meta">Rejected by ${esc(t.amountReviewedBy || '—')}${t.amountRejectionNote ? ' — ' + esc(t.amountRejectionNote) : ''}</div>`;
        }

        return `<div class="approval-card">
          <div class="approval-card-header">
            <div><span class="task-card-id">${esc(t.taskId)}</span><span class="badge ${t.hoOrCo === 'HO' ? 'badge-danger' : 'badge-success'}" style="margin-left:8px">${esc(t.hoOrCo)}</span></div>
            <span class="approval-date">${esc(formatDateDMY(extractDate(t.timestamp)))}</span>
          </div>
          <div class="approval-card-info">
            <div class="approval-detail"><span class="approval-detail-label">Created By</span><span>${esc(t.createdBy)}</span></div>
            <div class="approval-detail"><span class="approval-detail-label">Branch</span><span>${esc(t.branch)}</span></div>
            <div class="approval-detail"><span class="approval-detail-label">Issue</span><span>${esc(displayIssue(t))}</span></div>
          </div>
          <div class="approval-amounts">
            <div class="approval-amt-box"><div class="approval-amt-label">Expected</div><div class="approval-amt-value">₹${expected.toLocaleString('en-IN')}</div></div>
            <div class="approval-amt-arrow">→</div>
            <div class="approval-amt-box"><div class="approval-amt-label">Actual</div><div class="approval-amt-value" style="font-weight:700">₹${actual.toLocaleString('en-IN')}</div></div>
            <div class="approval-amt-diff ${diffClass}">${diffText}</div>
          </div>
          ${actions}
        </div>`;
      }).join('');

      // Bind approve/reject buttons
      $('approvalsGrid').querySelectorAll('[data-approve]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const taskId = btn.dataset.approve;
          await DataStore.update(taskId, { amountStatus: 'approved', amountReviewedBy: user.name, amountReviewedAt: formatDateTime(new Date()) });
          showToast('Approved!', 'success');
          await renderApprovals();
        });
      });
      $('approvalsGrid').querySelectorAll('[data-reject]').forEach(btn => {
        btn.addEventListener('click', () => {
          const taskId = btn.dataset.reject;
          showRejectDialog(taskId);
        });
      });

      // Show/hide Approve All button
      $('btnApproveAll').style.display = (approvalFilter === 'pending' && tasks.length > 0) ? '' : 'none';
    }

    // Approve All handler
    $('btnApproveAll').addEventListener('click', () => {
      showConfirm('✅ Approve All', `Approve all pending tasks at once?`, 'Approve All', async () => {
        const allTasks = await DataStore.getAll();
        const pending = allTasks.filter(t => t.amountStatus === 'pending');
        for (const t of pending) {
          await DataStore.update(t.taskId, { amountStatus: 'approved', amountReviewedBy: user.name, amountReviewedAt: formatDateTime(new Date()) });
        }
        showToast(`${pending.length} task(s) approved!`, 'success');
        await renderApprovals();
      });
    });

    function showRejectDialog(taskId) {
      const o = document.createElement('div'); o.className = 'confirm-overlay';
      o.innerHTML = `<div class="confirm-box" style="max-width:400px">
        <div class="confirm-title">❌ Reject Amount</div>
        <div class="confirm-message">
          <label style="font-size:0.85rem;font-weight:500;margin-bottom:4px;display:block">Reason for rejection (optional)</label>
          <textarea class="form-control" id="rejectNote" rows="3" placeholder="e.g., Get a cheaper quote, amount seems too high…" style="margin-top:4px"></textarea>
        </div>
        <div class="confirm-actions">
          <button class="btn btn-secondary" id="rejectCancel">Cancel</button>
          <button class="btn btn-danger" id="rejectConfirm">❌ Reject</button>
        </div>
      </div>`;
      document.body.appendChild(o);
      o.querySelector('#rejectCancel').addEventListener('click', () => o.remove());
      o.querySelector('#rejectConfirm').addEventListener('click', async () => {
        const note = o.querySelector('#rejectNote').value.trim();
        o.remove();
        await DataStore.update(taskId, { amountStatus: 'rejected', amountReviewedBy: user.name, amountReviewedAt: formatDateTime(new Date()), amountRejectionNote: note || null });
        showToast('Rejected.', 'warning');
        await renderApprovals();
      });
      o.addEventListener('click', e => { if (e.target === o) o.remove(); });
    }

    // ─── REPORTS ──────────────────────────────────────────────────────────────
    let selectedStaffId = '';
    let reportStatusFilter = 'all'; // 'all', 'inprogress', 'completed'
    let companyFilter = ''; // '', 'NLPL', 'NMSPL'
    const colFilters = { date: [], branch: [], issueType: [], hoOrCo: [] };

    // Company filter buttons
    document.querySelectorAll('.company-filter-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.company-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        companyFilter = btn.dataset.companyFilter;
        await renderReport();
      });
    });

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
      if (companyFilter === 'NLPL') tasks = tasks.filter(t => BRANCHES.includes(t.branch));
      else if (companyFilter === 'NMSPL') tasks = tasks.filter(t => NMSPL_BRANCHES.includes(t.branch));
      if (colFilters.date.length) tasks = tasks.filter(t => t.timestamp && colFilters.date.includes(extractDate(t.timestamp)));
      if (colFilters.branch.length) tasks = tasks.filter(t => colFilters.branch.includes(t.branch));
      if (colFilters.issueType.length) tasks = tasks.filter(t => colFilters.issueType.includes(t.issueType));
      if (colFilters.hoOrCo.length) tasks = tasks.filter(t => colFilters.hoOrCo.includes(t.hoOrCo));

      const showStaff = colFilters.hoOrCo.length > 0;
      const headers = showStaff
        ? ['Sr. No', 'Date', 'Created By', 'Branch', 'HO/CO', 'Staff Details', 'Issue Type', 'Issue Description', 'Status', 'Expected Amount', 'Actual Amount', 'Approval']
        : ['Sr. No', 'Date', 'Created By', 'Branch', 'HO/CO', 'Issue Type', 'Issue Description', 'Status', 'Expected Amount', 'Actual Amount', 'Approval'];

      const csvEscape = (val) => {
        const s = String(val == null ? '' : val).replace(/\u2014/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
        if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      };

      const rows = tasks.map((t, idx) => {
        const base = [
          idx + 1,
          formatDateDMY(extractDate(t.timestamp)),
          t.createdBy,
          t.branch,
          t.hoOrCo
        ];
        if (showStaff) base.push((t.staffName || '') + (t.staffDesignation ? ' — ' + t.staffDesignation : '') + (t.staffId ? ' (' + t.staffId + ')' : ''));
        base.push(
          t.issueType,
          displayIssue(t) || '',
          t.completed ? 'Completed' : 'In Progress',
          t.expectedAmount || t.amount || 0,
          t.actualAmount != null ? t.actualAmount : '',
          t.amountStatus === 'approved' ? 'Approved' : t.amountStatus === 'pending' ? 'Pending' : t.amountStatus === 'rejected' ? 'Rejected' : ''
        );
        return base.map(csvEscape).join(',');
      });
      const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'it_work_update_' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click(); URL.revokeObjectURL(url);
    });

    // Report table column header filters (full-screen modal)
    document.querySelectorAll('.th-filterable[data-rptcol]').forEach(th => {
      th.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeColFilterPopup();
        const col = th.dataset.rptcol;
        const allTasks = await DataStore.getAll();
        let vals;
        if (col === 'date') vals = [...new Set(allTasks.map(t => extractDate(t.timestamp)).filter(Boolean))].sort().reverse();
        else if (col === 'branch') vals = [...new Set(allTasks.map(t => t.branch).filter(Boolean))].sort();
        else if (col === 'issueType') vals = [...new Set(allTasks.map(t => t.issueType).filter(Boolean))].sort();
        else if (col === 'hoOrCo') vals = [...new Set(allTasks.map(t => t.hoOrCo).filter(Boolean))].sort();
        else return;
        if (!vals.length) return;

        const currentArr = colFilters[col] || [];
        let selected = [...currentArr];

        const overlay = document.createElement('div');
        overlay.className = 'col-filter-overlay'; overlay.id = 'colFilterPopup';
        const labels = { date: 'Date', branch: 'Branch', issueType: 'Issue Type', hoOrCo: 'HO/CO' };
        overlay.innerHTML = `
          <div class="col-filter-modal">
            <div class="col-filter-header"><span>Filter: ${labels[col]}</span><button class="popup-close">✕</button></div>
            <div class="col-filter-list">
              <div class="col-filter-item ${selected.length === 0 ? 'selected' : ''}" data-val="__all__"><span class="check-mark">${selected.length === 0 ? '✓' : ''}</span><span>Show All</span></div>
              ${vals.map(v => `<div class="col-filter-item ${selected.includes(v) ? 'selected' : ''}" data-val="${esc(v)}"><span class="check-mark">${selected.includes(v) ? '✓' : ''}</span><span>${col === 'date' ? formatDateDMY(v) : esc(v)}</span></div>`).join('')}
            </div>
            <div class="col-filter-footer">
              <button class="btn-filter-clear">Show All</button>
              <button class="btn-filter-apply">Apply</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);

        function refreshChecks() {
          overlay.querySelectorAll('.col-filter-item').forEach(item => {
            const v = item.dataset.val;
            const isSelected = v === '__all__' ? selected.length === 0 : selected.includes(v);
            item.classList.toggle('selected', isSelected);
            item.querySelector('.check-mark').textContent = isSelected ? '✓' : '';
          });
        }

        overlay.querySelector('.popup-close').addEventListener('click', closeColFilterPopup);
        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeColFilterPopup(); });
        overlay.querySelectorAll('.col-filter-item').forEach(item => {
          item.addEventListener('click', () => {
            const v = item.dataset.val;
            if (v === '__all__') { selected = []; }
            else {
              const idx = selected.indexOf(v);
              if (idx >= 0) selected.splice(idx, 1); else selected.push(v);
            }
            refreshChecks();
          });
        });
        overlay.querySelector('.btn-filter-clear').addEventListener('click', async () => {
          colFilters[col] = [];
          th.classList.remove('filtered');
          closeColFilterPopup();
          await renderReport();
        });
        overlay.querySelector('.btn-filter-apply').addEventListener('click', async () => {
          colFilters[col] = [...selected];
          th.classList.toggle('filtered', selected.length > 0);
          closeColFilterPopup();
          await renderReport();
        });
      });
    });

    async function renderReport() {
      let tasks = await DataStore.getAll();

      // Filter by status
      if (reportStatusFilter === 'inprogress') tasks = tasks.filter(t => !t.completed);
      else if (reportStatusFilter === 'completed') tasks = tasks.filter(t => t.completed);

      // Filter by selected staff
      if (selectedStaffId) {
        const u = allUsers.find(x => x.id === selectedStaffId);
        if (u) tasks = tasks.filter(t => t.createdBy === u.name);
      }
      // Company filter
      if (companyFilter === 'NLPL') tasks = tasks.filter(t => BRANCHES.includes(t.branch));
      else if (companyFilter === 'NMSPL') tasks = tasks.filter(t => NMSPL_BRANCHES.includes(t.branch));

      // Column header filters (multi-select)
      if (colFilters.date.length) tasks = tasks.filter(t => t.timestamp && colFilters.date.includes(extractDate(t.timestamp)));
      if (colFilters.branch.length) tasks = tasks.filter(t => colFilters.branch.includes(t.branch));
      if (colFilters.issueType.length) tasks = tasks.filter(t => colFilters.issueType.includes(t.issueType));
      if (colFilters.hoOrCo.length) tasks = tasks.filter(t => colFilters.hoOrCo.includes(t.hoOrCo));

      const showStaffCol = colFilters.hoOrCo.length > 0;
      const totalCols = showStaffCol ? 12 : 11;

      const ip = tasks.filter(t => !t.completed).length;
      const done = tasks.filter(t => t.completed).length;
      const totalExpected = tasks.reduce((s, t) => s + (t.expectedAmount || t.amount || 0), 0);
      const approvedAmt = tasks.filter(t => t.amountStatus === 'approved').reduce((s, t) => s + (t.actualAmount || t.amount || 0), 0);
      const pendingAmt = tasks.filter(t => t.amountStatus === 'pending').reduce((s, t) => s + (t.actualAmount || 0), 0);

      $('reportSummary').innerHTML = `
        <div class="report-summary-card"><div class="report-summary-num">${tasks.length}</div><div class="report-summary-label">Total</div></div>
        <div class="report-summary-card"><div class="report-summary-num" style="color:var(--warning)">${ip}</div><div class="report-summary-label">In Progress</div></div>
        <div class="report-summary-card"><div class="report-summary-num" style="color:var(--success)">${done}</div><div class="report-summary-label">Completed</div></div>
        <div class="report-summary-card"><div class="report-summary-num" style="color:var(--primary)">₹${totalExpected.toLocaleString('en-IN')}</div><div class="report-summary-label">Expected Total</div></div>
        <div class="report-summary-card"><div class="report-summary-num" style="color:#16a34a">₹${approvedAmt.toLocaleString('en-IN')}</div><div class="report-summary-label">Approved</div></div>
        ${pendingAmt > 0 ? `<div class="report-summary-card"><div class="report-summary-num" style="color:#f59e0b">₹${pendingAmt.toLocaleString('en-IN')}</div><div class="report-summary-label">Pending</div></div>` : ''}
      `;

      // Dynamically add/remove Staff Details header
      const thead = $('reportTableWrap').querySelector('thead tr');
      const existingStaffTh = thead.querySelector('[data-col="staffDetails"]');
      if (showStaffCol && !existingStaffTh) {
        const hoCoTh = thead.querySelector('[data-rptcol="hoOrCo"]');
        const staffTh = document.createElement('th');
        staffTh.setAttribute('data-col', 'staffDetails');
        staffTh.textContent = 'Staff Details';
        hoCoTh.after(staffTh);
      } else if (!showStaffCol && existingStaffTh) {
        existingStaffTh.remove();
      }

      if (tasks.length === 0) {
        $('reportTableBody').innerHTML = `<tr><td colspan="${totalCols}" style="text-align:center;padding:40px;color:var(--text-muted)">No tasks match your filters.</td></tr>`;
        return;
      }

      $('reportTableBody').innerHTML = tasks.map(t => {
        const typeCls = { Software: 'badge-primary', Hardware: 'badge-warning', Both: 'badge-info' }[t.issueType] || 'badge-gray';
        const hocoCls = t.hoOrCo === 'HO' ? 'badge-danger' : 'badge-success';
        const statusCls = t.completed ? 'badge-success' : 'badge-warning';
        const statusTxt = t.completed ? '✅ Done' : '⏳ Active';
        const staffCol = showStaffCol ? `<td>${esc((t.staffName || '') + (t.staffDesignation ? ' — ' + t.staffDesignation : '') + (t.staffId ? ' (' + t.staffId + ')' : ''))}</td>` : '';
        return `<tr data-rptview="${t.taskId}">
          <td class="task-id-cell">${esc(t.taskId)}</td>
          <td>${esc(formatDateDMY(extractDate(t.timestamp)))}</td>
          <td>${esc(t.createdBy)}</td>
          <td>${esc(t.branch)}</td>
          <td><span class="badge ${hocoCls}">${esc(t.hoOrCo)}</span></td>
          ${staffCol}
          <td><span class="badge ${typeCls}">${esc(t.issueType)}</span></td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(displayIssue(t))}</td>
          <td><span class="badge ${statusCls}">${statusTxt}</span></td>
          <td>₹${(t.expectedAmount || t.amount || 0).toLocaleString('en-IN')}</td>
          <td>${t.actualAmount != null ? '₹' + t.actualAmount.toLocaleString('en-IN') : '—'}</td>
          <td>${(() => { const s = t.amountStatus || 'none'; if (s === 'approved') return '<span class="badge badge-success">Approved</span>'; if (s === 'pending') return '<span class="badge badge-amount-pending">Pending</span>'; if (s === 'rejected') return '<span class="badge badge-amount-rejected">Rejected</span>'; return '—'; })()}</td>
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
        const day = extractDate(t.completedAt) || extractDate(t.timestamp) || null;
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

    await Promise.all([renderAdminOverview(), renderFinancialOverview(), renderStaffSelector().then(() => renderReport())]);

    // Refresh periodically
    setInterval(async () => { await renderAdminOverview(); if (adminTab === 'overview') await renderFinancialOverview(); if (adminTab === 'approvals') await renderApprovals(); if (adminTab === 'reports') await renderReport(); if (adminTab === 'duration') await renderDuration(); }, 5000);

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
  const staffSectionHoCo = $('staffSectionHoCo'), fStaffName = $('fStaffName'), fStaffId = $('fStaffId');
  const staffSectionBranch = $('staffSectionBranch'), fBranchStaffName = $('fBranchStaffName'), fBranchDesignation = $('fBranchDesignation'), fBranchStaffId = $('fBranchStaffId');
  const fIssueType = $('fIssueType'), fIssueCategory = $('fIssueCategory'), fIssueDesc = $('fIssueDesc'), issueOtherWrap = $('issueOtherWrap'), fSolution = $('fSolution');
  const fDetailedDesc = $('fDetailedDesc'), fAmount = $('fAmount');
  const issueAutocomplete = $('issueAutocomplete'); document.body.appendChild(issueAutocomplete);
  const reviewSummary = $('reviewSummary');
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

  // Only show staff for Head Office / Corporate Office
  function isHoCo(branch) {
    return branch === 'Head Office' || branch === 'Corporate Office';
  }

  // Branch → staff dropdown (only for HO/CO)
  fBranch.addEventListener('change', () => {
    if (fBranch.value && isHoCo(fBranch.value)) {
      staffSectionHoCo.classList.remove('hidden');
      staffSectionBranch.classList.add('hidden');
      fBranchStaffName.value = ''; fBranchDesignation.value = ''; fBranchStaffId.value = '';
      populateStaffDropdown(fBranch.value);
    } else if (fBranch.value) {
      staffSectionBranch.classList.remove('hidden');
      staffSectionHoCo.classList.add('hidden');
      fStaffName.value = ''; fStaffId.value = '';
    } else {
      staffSectionHoCo.classList.add('hidden');
      staffSectionBranch.classList.add('hidden');
      fStaffName.value = ''; fStaffId.value = '';
      fBranchStaffName.value = ''; fBranchDesignation.value = ''; fBranchStaffId.value = '';
    }
  });

  const customStaffFields = $('customStaffFields'), fCustomStaffName = $('fCustomStaffName'), fCustomStaffId = $('fCustomStaffId');

  function populateStaffDropdown(location) {
    const employees = getActiveEmployeesByLocation(location);
    const company = selectedCompany || 'NLPL';
    const custom = getCustomStaffByLocation(company, location);
    fStaffName.innerHTML = '<option value="">-- Select Staff --</option><option value="__other__">➕ Other (Not in list)</option>';
    employees.forEach(e => {
      const o = document.createElement('option');
      o.value = e.name;
      o.textContent = `${e.name} (${e.emp_id})`;
      o.dataset.empId = e.emp_id;
      fStaffName.appendChild(o);
    });
    custom.forEach(e => {
      const o = document.createElement('option');
      o.value = e.name;
      o.textContent = e.emp_id ? `${e.name} (${e.emp_id})` : e.name;
      o.dataset.empId = e.emp_id || '';
      o.dataset.custom = 'true';
      fStaffName.appendChild(o);
    });
    fStaffId.value = '';
    customStaffFields.classList.add('hidden');
    fCustomStaffName.value = ''; fCustomStaffId.value = '';
  }

  fStaffName.addEventListener('change', () => {
    if (fStaffName.value === '__other__') {
      customStaffFields.classList.remove('hidden');
      fStaffId.value = '';
      fCustomStaffName.value = ''; fCustomStaffId.value = '';
    } else {
      customStaffFields.classList.add('hidden');
      fCustomStaffName.value = ''; fCustomStaffId.value = '';
      const selected = fStaffName.options[fStaffName.selectedIndex];
      fStaffId.value = selected && selected.dataset.empId ? selected.dataset.empId : '';
    }
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

  // Issue category dropdown → always show description field
  fIssueCategory.addEventListener('change', async () => {
    const cat = fIssueCategory.value;
    if (cat) {
      issueOtherWrap.classList.remove('hidden');
      fIssueDesc.value = '';
      fIssueDesc.placeholder = cat === 'Other' ? 'Type the issue...' : `Describe the ${cat} issue...`;
      // Show/hide required marker (only required for "Other")
      const req = $('issueDescReq');
      if (req) req.style.display = cat === 'Other' ? '' : 'none';
      // Load category-specific history for autocomplete
      issueHistoryCache = await IssueHistory.get(user.id, cat);
      fIssueDesc.focus();
    } else {
      issueOtherWrap.classList.add('hidden');
      fIssueDesc.value = '';
      issueHistoryCache = [];
    }
  });

  // Autocomplete (filtered by selected category)
  issueHistoryCache = [];

  function positionAutocomplete() {
    const rect = fIssueDesc.getBoundingClientRect();
    issueAutocomplete.style.left = rect.left + 'px';
    issueAutocomplete.style.width = rect.width + 'px';
    // Show above if not enough room below, otherwise below
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 220) {
      issueAutocomplete.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
      issueAutocomplete.style.top = 'auto';
    } else {
      issueAutocomplete.style.top = (rect.bottom + 4) + 'px';
      issueAutocomplete.style.bottom = 'auto';
    }
  }

  fIssueDesc.addEventListener('input', () => {
    const val = fIssueDesc.value.trim().toLowerCase();
    if (!val) { issueAutocomplete.classList.add('hidden'); return; }
    const m = issueHistoryCache.filter(h => h.toLowerCase().includes(val));
    if (!m.length) { issueAutocomplete.classList.add('hidden'); return; }
    issueAutocomplete.innerHTML = m.slice(0, 8).map(x => `<div class="autocomplete-item">${esc(x)}</div>`).join('');
    positionAutocomplete();
    issueAutocomplete.classList.remove('hidden');
    issueAutocomplete.querySelectorAll('.autocomplete-item').forEach(el => { el.addEventListener('click', () => { fIssueDesc.value = el.textContent; issueAutocomplete.classList.add('hidden'); }); });
  });
  fIssueDesc.addEventListener('blur', () => setTimeout(() => issueAutocomplete.classList.add('hidden'), 200));

  // Word counters
  function countWords(t) { t = (t || '').trim(); return t ? t.split(/\s+/).length : 0; }
  fSolution.addEventListener('input', () => { const w = countWords(fSolution.value); solutionWordCount.textContent = w; solutionWordCount.parentElement.style.color = w > 50 ? 'var(--danger)' : 'var(--text-muted)'; });
  fDetailedDesc.addEventListener('input', () => { const w = countWords(fDetailedDesc.value); descWordCount.textContent = w; descWordCount.parentElement.style.color = w === 0 ? 'var(--text-muted)' : (w >= 500 && w <= 1000 ? 'var(--success)' : 'var(--warning)'); });

  // Amount field (wizard) — clear "0" on focus so user can type directly
  fAmount.addEventListener('focus', () => { if (fAmount.value === '0' || fAmount.value === '0.00') fAmount.value = ''; });
  fAmount.addEventListener('blur', () => { if (!fAmount.value) fAmount.value = 0; });

  // Wizard
  fab.addEventListener('click', () => {
    if (!selectedCompany) {
      // Shake the company selector card and show error
      const card = $('companySelector');
      const err = $('companyError');
      if (card) {
        card.classList.remove('shake');
        void card.offsetWidth; // reflow to restart animation
        card.classList.add('shake');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (err) err.classList.remove('hidden');
      setTimeout(() => { if (err) err.classList.add('hidden'); }, 3000);
      return;
    }
    openAddWizard();
  });
  modalClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);
  // Do not close modal on backdrop click — user might lose data
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
  // ─── EDIT SHEET ────────────────────────────────────────────────────────────
  const editOverlay = $('editOverlay');
  const edDate = $('edDate'), edTime = $('edTime'), edBranch = $('edBranch');
  const edStaff = $('edStaff'), edEmpId = $('edEmpId'), edHoCo = $('edHoCo');
  const edIssueType = $('edIssueType'), edIssueCategory = $('edIssueCategory');
  const edIssueOtherWrap = $('edIssueOtherWrap'), edIssueDesc = $('edIssueDesc');
  const edSolution = $('edSolution'), edDetailedDesc = $('edDetailedDesc'), edAmount = $('edAmount');
  let editingId = null;

  // Amount field (edit modal) — clear "0" on focus
  edAmount.addEventListener('focus', () => { if (edAmount.value === '0' || edAmount.value === '0.00') edAmount.value = ''; });
  edAmount.addEventListener('blur', () => { if (!edAmount.value) edAmount.value = 0; });

  $('editClose').addEventListener('click', closeEdit);
  $('editCancelBtn').addEventListener('click', closeEdit);
  // Do not close edit sheet on backdrop click — user might lose data

  function closeEdit() { editOverlay.classList.remove('open'); document.body.style.overflow = ''; }

  // Populate branch dropdown in edit sheet
  function populateEditBranches() {
    edBranch.innerHTML = '<option value="">-- Select --</option>';
    (selectedCompany === 'NMSPL' ? NMSPL_BRANCHES : BRANCHES).forEach(b => { const o = document.createElement('option'); o.value = b; o.textContent = b; edBranch.appendChild(o); });
  }

  const edCustomStaffFields = $('edCustomStaffFields'), edCustomStaffName = $('edCustomStaffName'), edCustomStaffId = $('edCustomStaffId');

  function populateEditStaffDropdown(location) {
    const emps = getActiveEmployeesByLocation(location);
    const company = selectedCompany || 'NLPL';
    const custom = getCustomStaffByLocation(company, location);
    edStaff.innerHTML = '<option value="">-- Select --</option><option value="__other__">➕ Other (Not in list)</option>';
    emps.forEach(e => {
      const o = document.createElement('option');
      o.value = e.name; o.textContent = `${e.name} (${e.emp_id})`; o.dataset.empId = e.emp_id;
      edStaff.appendChild(o);
    });
    custom.forEach(e => {
      const o = document.createElement('option');
      o.value = e.name; o.textContent = e.emp_id ? `${e.name} (${e.emp_id})` : e.name; o.dataset.empId = e.emp_id || '';
      edStaff.appendChild(o);
    });
  }

  edBranch.addEventListener('change', () => {
    edCustomStaffFields.classList.add('hidden');
    edCustomStaffName.value = ''; edCustomStaffId.value = '';
    if (edBranch.value && isHoCo(edBranch.value)) {
      $('edStaffSectionHoCo').classList.remove('hidden');
      $('edEmpIdFieldHoCo').classList.remove('hidden');
      $('edStaffSectionBranch').classList.add('hidden');
      $('edBranchStaffName').value = ''; $('edBranchDesignation').value = ''; $('edBranchStaffId').value = '';
      populateEditStaffDropdown(edBranch.value);
    } else if (edBranch.value) {
      $('edStaffSectionBranch').classList.remove('hidden');
      $('edStaffSectionHoCo').classList.add('hidden');
      $('edEmpIdFieldHoCo').classList.add('hidden');
      edStaff.innerHTML = '<option value="">-- Select --</option>';
      edStaff.value = '';
    } else {
      $('edStaffSectionHoCo').classList.add('hidden');
      $('edEmpIdFieldHoCo').classList.add('hidden');
      $('edStaffSectionBranch').classList.add('hidden');
      edStaff.innerHTML = '<option value="">-- Select --</option>';
      edStaff.value = '';
    }
    edEmpId.textContent = '';
  });

  edStaff.addEventListener('change', () => {
    if (edStaff.value === '__other__') {
      edCustomStaffFields.classList.remove('hidden');
      edEmpId.textContent = '';
      edCustomStaffName.value = ''; edCustomStaffId.value = '';
    } else {
      edCustomStaffFields.classList.add('hidden');
      edCustomStaffName.value = ''; edCustomStaffId.value = '';
      const sel = edStaff.options[edStaff.selectedIndex];
      edEmpId.textContent = sel && sel.dataset.empId ? sel.dataset.empId : '';
    }
  });

  edIssueCategory.addEventListener('change', () => {
    const cat = edIssueCategory.value;
    if (cat) {
      edIssueOtherWrap.classList.remove('hidden');
      edIssueDesc.value = '';
      edIssueDesc.placeholder = cat === 'Other' ? 'Type the issue...' : `Describe the ${cat} issue...`;
      const req = $('edIssueDescReq');
      if (req) req.style.display = cat === 'Other' ? '' : 'none';
    } else {
      edIssueOtherWrap.classList.add('hidden');
      edIssueDesc.value = '';
    }
  });

  function parseTimestamp(ts) {
    if (!ts) return { date: '', time: '' };
    // Handle ISO format (from Supabase timestamptz) or "YYYY-MM-DD HH:MM:SS"
    const d = new Date(ts);
    if (!isNaN(d)) {
      const pad = n => String(n).padStart(2, '0');
      return {
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
      };
    }
    const parts = ts.split(' ');
    return { date: parts[0] || '', time: parts[1] || '' };
  }

  async function openEditSheet(taskId) {
    const task = await DataStore.getById(taskId); if (!task) return;
    editingId = taskId;

    $('editTitle').textContent = '✏️ Edit Task #' + task.taskId;
    $('edTaskId').textContent = task.taskId;

    // Date/time
    const ts = parseTimestamp(task.timestamp);
    edDate.value = ts.date;
    edTime.value = ts.time;

    // Branch + staff
    populateEditBranches();
    edBranch.value = task.branch || '';
    edBranch.dispatchEvent(new Event('change'));
    if (isHoCo(task.branch)) {
      edStaff.value = task.staffName || '';
      edStaff.dispatchEvent(new Event('change'));
    } else {
      $('edBranchStaffName').value = task.staffName || '';
      $('edBranchDesignation').value = task.staffDesignation || '';
      $('edBranchStaffId').value = task.staffId || '';
    }

    edHoCo.textContent = task.hoOrCo || user.hoOrCo;
    edIssueType.value = task.issueType || 'Software';

    // Issue category — new format uses issueCategory, old format derives from issueDescription
    const presets = ['System Monitor','CPU','Printer','UPS Invertor','UPS Battery','CCTV Set','Cash Counting Machine','Tab','Laptop','Bluetooth Printer','Biometric'];
    if (task.issueCategory) {
      edIssueCategory.value = task.issueCategory;
      edIssueDesc.value = task.issueDescription || '';
    } else {
      const issueVal = task.issueDescription || '';
      if (presets.includes(issueVal)) {
        edIssueCategory.value = issueVal;
        edIssueDesc.value = '';
      } else {
        edIssueCategory.value = 'Other';
        edIssueDesc.value = issueVal;
      }
    }
    // Always show description field
    edIssueOtherWrap.classList.remove('hidden');
    const cat = edIssueCategory.value;
    edIssueDesc.placeholder = cat === 'Other' ? 'Type the issue...' : `Describe the ${cat} issue...`;
    const edReq = $('edIssueDescReq');
    if (edReq) edReq.style.display = cat === 'Other' ? '' : 'none';

    edSolution.value = task.solution || '';
    edDetailedDesc.value = task.detailedDescription || '';
    edAmount.value = task.expectedAmount ?? task.amount ?? 0;
    // Show approval status for all tasks
    const edActualField = $('edActualAmountField');
    const edStatusField = $('edAmountStatusField');
    if (task.actualAmount != null) {
      edActualField.classList.remove('hidden');
      $('edActualAmountDisplay').textContent = '₹' + (task.actualAmount || 0).toLocaleString('en-IN');
    } else {
      edActualField.classList.add('hidden');
    }
    if (task.amountStatus && task.amountStatus !== 'none') {
      edStatusField.classList.remove('hidden');
      const statusLabels = { pending: '⏳ Pending Approval', approved: '✅ Approved', rejected: '❌ Rejected' };
      $('edAmountStatusDisplay').innerHTML = statusLabels[task.amountStatus] || '—';
      if (task.amountStatus === 'rejected' && task.amountRejectionNote) {
        $('edAmountStatusDisplay').innerHTML += `<div style="font-size:0.8rem;color:var(--danger);margin-top:4px">Note: ${esc(task.amountRejectionNote)}</div>`;
      }
    } else {
      edStatusField.classList.add('hidden');
    }
    $('editError').textContent = '';

    // Only show Complete button if admin has approved
    $('editCompleteBtn').classList.toggle('hidden', task.amountStatus !== 'approved' || task.completed);
    // Show resubmit label on save button if rejected
    $('editSaveBtn').textContent = task.amountStatus === 'rejected' ? '🔄 Resubmit for Approval' : '💾 Save';

    editOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  async function getEditFormData() {
    const isHoCoEdit = isHoCo(edBranch.value);
    const staffSel = edStaff.options[edStaff.selectedIndex];
    let staffName, staffId;
    if (isHoCoEdit) {
      if (edStaff.value === '__other__') {
        staffName = edCustomStaffName.value.trim();
        staffId = edCustomStaffId.value.trim();
        await addCustomStaff(selectedCompany || 'NLPL', staffName, staffId || null, edBranch.value, user.name);
      } else {
        staffName = edStaff.value;
        staffId = staffSel && staffSel.dataset.empId ? staffSel.dataset.empId : '';
      }
    } else {
      staffName = $('edBranchStaffName').value.trim();
      staffId = $('edBranchStaffId').value.trim();
    }
    return {
      timestamp: `${edDate.value} ${edTime.value}`,
      branch: edBranch.value,
      hoOrCo: edHoCo.textContent,
      staffName,
      staffId,
      staffDesignation: isHoCoEdit ? '' : $('edBranchDesignation').value.trim(),
      issueType: edIssueType.value,
      issueCategory: edIssueCategory.value,
      issueDescription: edIssueDesc.value.trim(),
      solution: edSolution.value.trim(),
      detailedDescription: edDetailedDesc.value.trim(),
      amount: parseFloat(edAmount.value) || 0,
      expectedAmount: parseFloat(edAmount.value) || 0
    };
  }

  function validateEditForm() {
    $('editError').textContent = '';
    if (!edBranch.value) { $('editError').textContent = 'Select a branch.'; return false; }
    if (isHoCo(edBranch.value) && !edStaff.value) { $('editError').textContent = 'Select a staff member for HO/CO.'; return false; }
    if (isHoCo(edBranch.value) && edStaff.value === '__other__' && !edCustomStaffName.value.trim()) { $('editError').textContent = 'Enter the staff name.'; return false; }
    if (!edIssueCategory.value) { $('editError').textContent = 'Select an issue category.'; return false; }
    if (edIssueCategory.value === 'Other' && !edIssueDesc.value.trim()) { $('editError').textContent = 'Describe the issue.'; return false; }
    if (!edSolution.value.trim()) { $('editError').textContent = 'Solution is required.'; return false; }
    return true;
  }

  $('editSaveBtn').addEventListener('click', async () => {
    if (saving || !validateEditForm()) return;
    saving = true; $('editSaveBtn').disabled = true; $('editCompleteBtn').disabled = true;
    try {
      const editData = await getEditFormData();
      // If task was rejected, resubmit for approval
      const currentTask = await DataStore.getById(editingId);
      if (currentTask && currentTask.amountStatus === 'rejected') {
        editData.amountStatus = 'pending';
        editData.amountRejectionNote = null;
        editData.amountReviewedBy = null;
        editData.amountReviewedAt = null;
      }
      await DataStore.update(editingId, editData);
      if (editData.issueDescription) { await IssueHistory.save(user.id, editData.issueDescription, editData.issueCategory); issueHistoryCache = await IssueHistory.get(user.id, editData.issueCategory); }
      const msg = editData.amountStatus === 'pending' ? 'Resubmitted for approval.' : 'Updated.';
      showToast(msg, 'success');
      closeEdit(); await renderAll();
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
    saving = false; $('editSaveBtn').disabled = false; $('editCompleteBtn').disabled = false;
  });

  $('editCompleteBtn').addEventListener('click', () => {
    if (saving || !validateEditForm()) return;
    const expectedAmt = parseFloat($('edAmount').value) || 0;
    showActualAmountDialog(expectedAmt, async (actualAmount) => {
      if (saving) return;
      saving = true; $('editSaveBtn').disabled = true; $('editCompleteBtn').disabled = true;
      try {
        const updates = await getEditFormData();
        updates.completed = true;
        updates.completedAt = formatDateTime(new Date());
        updates.actualAmount = actualAmount;
        updates.amount = actualAmount;
        await DataStore.update(editingId, updates);
        showToast('Completed!', 'success');
        closeEdit(); await renderAll();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
      saving = false; $('editSaveBtn').disabled = false; $('editCompleteBtn').disabled = false;
    });
  });
  function goToStep(step) {
    state.wizardStep = step;
    for (let i = 1; i <= TOTAL_STEPS; i++) { const el = $('step' + i); if (el) el.classList.toggle('hidden', i !== step); }
    stepperBar.querySelectorAll('.stepper-step').forEach(el => { const s = parseInt(el.dataset.step); el.classList.toggle('active', s === step); el.classList.toggle('done', s < step); });
    btnPrev.classList.toggle('hidden', step === 1); btnNext.classList.toggle('hidden', step === TOTAL_STEPS);
    btnSave.classList.toggle('hidden', step !== TOTAL_STEPS); btnComplete.classList.add('hidden');
    if (step === TOTAL_STEPS) buildReviewSummary();
  }
  function openModal() { modalOverlay.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeModal() { modalOverlay.classList.remove('open'); document.body.style.overflow = ''; issueAutocomplete.classList.add('hidden'); }

  function validateStep(step) {
    clearAllErrors();
    if (step === 1) { let ok = true; if (!fBranch.value) { setErr('errBranch', 'Select a branch.'); ok = false; } if (isHoCo(fBranch.value)) { if (!fStaffName.value) { setErr('errStaffName', 'Select a staff member.'); ok = false; } else if (fStaffName.value === '__other__' && !fCustomStaffName.value.trim()) { setErr('errCustomStaffName', 'Enter the staff name.'); ok = false; } } return ok; }
    if (step === 2) { if (!fIssueType.value) { setErr('errIssueType', 'Select at least one.'); return false; } return true; }
    if (step === 3) { if (!fIssueCategory.value) { setErr('errIssueDesc', 'Select an issue category.'); return false; } if (fIssueCategory.value === 'Other' && !fIssueDesc.value.trim()) { setErr('errIssueDesc', 'Describe the issue.'); return false; } return true; }
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
      ${(() => { const hoCoR = isHoCo(fBranch.value); let sn, si, sd; if (hoCoR) { sn = fStaffName.value === '__other__' ? fCustomStaffName.value : fStaffName.value; si = fStaffName.value === '__other__' ? fCustomStaffId.value : fStaffId.value; sd = ''; } else { sn = fBranchStaffName.value; si = fBranchStaffId.value; sd = fBranchDesignation.value; } if (!sn) return ''; let staffTxt = esc(sn); if (sd) staffTxt += ' — ' + esc(sd); if (si) staffTxt += ' (' + esc(si) + ')'; return `<div class="detail-field"><div class="detail-label">Staff</div><div class="detail-value">${staffTxt}</div></div>`; })()}
      <div class="detail-field"><div class="detail-label">Issue Type</div><div class="detail-value">${esc(fIssueType.value)}</div></div>
      <div class="detail-field"><div class="detail-label">Expected Amount</div><div class="detail-value">₹${amt.toLocaleString('en-IN')}</div></div>
    </div><div style="margin-top:10px"><div class="detail-label">Issue</div><div class="detail-value" style="margin-top:3px">${esc(fIssueCategory.value === 'Other' ? fIssueDesc.value : (fIssueDesc.value.trim() ? fIssueCategory.value + ' — ' + fIssueDesc.value : fIssueCategory.value))}</div></div>
    <div style="margin-top:10px"><div class="detail-label">Solution</div><div class="detail-value" style="margin-top:3px">${esc(fSolution.value)}</div></div>${desc}`;
  }

  async function buildTaskFromForm() {
    const taskId = state.editingTaskId || await generateTaskId();
    const hoCoForm = isHoCo(fBranch.value);
    let staffName, staffId;
    if (hoCoForm) {
      if (fStaffName.value === '__other__') {
        staffName = fCustomStaffName.value.trim();
        staffId = fCustomStaffId.value.trim();
        // Save to custom_staff table for future use
        await addCustomStaff(selectedCompany || 'NLPL', staffName, staffId || null, fBranch.value, user.name);
      } else {
        staffName = fStaffName.value.trim();
        staffId = fStaffId.value.trim();
      }
    } else {
      staffName = fBranchStaffName.value.trim();
      staffId = fBranchStaffId.value.trim();
    }
    const expectedAmt = parseFloat(fAmount.value) || 0;
    return { taskId, timestamp: `${fDate.value} ${fTime.value}`, branch: fBranch.value, hoOrCo: fHoCo.value, staffName, staffId, staffDesignation: hoCoForm ? '' : fBranchDesignation.value.trim(), issueType: fIssueType.value, issueCategory: fIssueCategory.value, issueDescription: fIssueDesc.value.trim(), solution: fSolution.value.trim(), detailedDescription: fDetailedDesc.value.trim(), amount: expectedAmt, expectedAmount: expectedAmt, actualAmount: null, amountStatus: 'pending', completed: false, completedAt: null, createdBy: user.name };
  }
  function showActualAmountDialog(expectedAmount, onConfirm) {
    const o = document.createElement('div'); o.className = 'confirm-overlay';
    const expFmt = (expectedAmount || 0).toLocaleString('en-IN');
    o.innerHTML = `<div class="confirm-box" style="max-width:400px">
      <div class="confirm-title">💰 Enter Actual Amount</div>
      <div class="confirm-message">
        <div style="margin-bottom:12px">Enter the actual cost for this task.</div>
        <div style="display:flex;justify-content:space-between;padding:8px 12px;background:var(--surface);border-radius:8px;margin-bottom:12px">
          <span style="color:var(--text-muted)">Expected Amount</span>
          <span style="font-weight:600">₹${expFmt}</span>
        </div>
        <label style="font-size:0.85rem;font-weight:500;margin-bottom:4px;display:block">Actual Amount (₹)</label>
        <div class="amount-field" style="margin-top:4px">
          <span class="currency-symbol">₹</span>
          <input class="form-control" type="number" id="actualAmountInput" value="${expectedAmount || 0}" min="0" step="0.01" style="font-size:1.1rem;font-weight:600" />
        </div>
        <div id="amountDiffNote" style="margin-top:8px;font-size:0.8rem;padding:6px 10px;border-radius:6px;display:none"></div>
      </div>
      <div class="confirm-actions">
        <button class="btn btn-secondary" id="actualAmtCancel">Cancel</button>
        <button class="btn btn-success" id="actualAmtConfirm">✅ Confirm & Complete</button>
      </div>
    </div>`;
    document.body.appendChild(o);
    const inp = o.querySelector('#actualAmountInput');
    const diffNote = o.querySelector('#amountDiffNote');
    function updateDiff() {
      const actual = parseFloat(inp.value) || 0;
      const diff = actual - (expectedAmount || 0);
      if (diff === 0) { diffNote.style.display = 'none'; return; }
      diffNote.style.display = 'block';
      if (diff > 0) {
        diffNote.style.background = '#fef2f2'; diffNote.style.color = '#dc2626';
        diffNote.textContent = `⬆ ₹${diff.toLocaleString('en-IN')} more than expected`;
      } else {
        diffNote.style.background = '#f0fdf4'; diffNote.style.color = '#16a34a';
        diffNote.textContent = `⬇ ₹${Math.abs(diff).toLocaleString('en-IN')} less than expected`;
      }
    }
    inp.addEventListener('input', updateDiff);
    inp.addEventListener('focus', () => { if (inp.value === '0' || inp.value === '0.00') inp.value = ''; });
    inp.addEventListener('blur', () => { if (!inp.value) inp.value = 0; });
    updateDiff();
    inp.select();
    o.querySelector('#actualAmtCancel').addEventListener('click', () => o.remove());
    o.querySelector('#actualAmtConfirm').addEventListener('click', () => { const val = parseFloat(inp.value) || 0; o.remove(); onConfirm(val); });
    o.addEventListener('click', e => { if (e.target === o) o.remove(); });
  }

  var saving = false;
  async function handleSave() {
    if (saving) return;
    saving = true; btnSave.disabled = true; btnComplete.disabled = true;
    try {
      const d = await buildTaskFromForm(); if (d.issueDescription) { await IssueHistory.save(user.id, d.issueDescription, d.issueCategory); issueHistoryCache = await IssueHistory.get(user.id, d.issueCategory); }
      if (state.editingTaskId) { await DataStore.update(state.editingTaskId, d); showToast('Updated & sent for approval.', 'success'); }
      else { await DataStore.add(d); showToast('Task created & sent for approval.', 'success'); }
      closeModal(); await renderAll();
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
    saving = false; btnSave.disabled = false; btnComplete.disabled = false;
  }
  async function handleComplete() {
    if (saving) return;
    const expectedAmt = parseFloat(fAmount.value) || 0;
    showActualAmountDialog(expectedAmt, async (actualAmount) => {
      if (saving) return;
      saving = true; btnSave.disabled = true; btnComplete.disabled = true;
      try {
        const d = await buildTaskFromForm();
        d.completed = true; d.completedAt = formatDateTime(new Date());
        d.actualAmount = actualAmount;
        d.amount = actualAmount;
        if (d.issueDescription) { await IssueHistory.save(user.id, d.issueDescription, d.issueCategory); issueHistoryCache = await IssueHistory.get(user.id, d.issueCategory); }
        if (state.editingTaskId) await DataStore.update(state.editingTaskId, d); else await DataStore.add(d);
        closeModal(); showToast('Completed!', 'success'); await renderAll();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
      saving = false; btnSave.disabled = false; btnComplete.disabled = false;
    });
  }

  function resetForm() {
    [fDate, fTime, fBranch, fStaffName, fStaffId, fBranchStaffName, fBranchDesignation, fBranchStaffId, fIssueType, fIssueCategory, fIssueDesc, fSolution, fDetailedDesc].forEach(el => { if (el) el.value = ''; });
    fHoCo.value = user.hoOrCo || 'CO'; fAmount.value = 0; staffSectionHoCo.classList.add('hidden'); staffSectionBranch.classList.add('hidden'); issueOtherWrap.classList.add('hidden'); customStaffFields.classList.add('hidden'); fCustomStaffName.value = ''; fCustomStaffId.value = '';
    boxSoftware.classList.remove('selected'); boxHardware.classList.remove('selected');
    state.selectedIssueTypes = []; clearAllErrors();
    if (solutionWordCount) solutionWordCount.textContent = '0'; if (descWordCount) descWordCount.textContent = '0';
    reviewSummary.innerHTML = '';
  }
  function setFormReadonly(ro) {
    [fDate, fTime, fBranch, fHoCo, fStaffName, fStaffId, fBranchStaffName, fBranchDesignation, fBranchStaffId, fCustomStaffName, fCustomStaffId, fIssueDesc, fSolution, fDetailedDesc, fAmount].forEach(el => { if (el) el.disabled = ro; });
    boxSoftware.style.pointerEvents = ro ? 'none' : ''; boxHardware.style.pointerEvents = ro ? 'none' : '';
  }
  // populateBranchDropdown is defined at the top-level scope (handles NLPL/NMSPL switching)

  async function renderAll() { await Promise.all([renderTasks(), updateNavBadges()]); }
  async function updateNavBadges() {
    const s = await DataStore.getStats(user.name);
    $('navBadgeInProgress').textContent = s.inProgress; $('navBadgeCompleted').textContent = s.completed;
    $('navBadgeSoftware').textContent = s.software; $('navBadgeHardware').textContent = s.hardware; $('navBadgeBoth').textContent = s.both;
  }

  // Completed table column header filters
  const activeFilterBar = $('activeFilterBar');

  document.querySelectorAll('.th-filterable[data-col]').forEach(th => {
    th.addEventListener('click', async (e) => {
      e.stopPropagation(); closeColFilterPopup();
      const col = th.dataset.col;
      const completed = await DataStore.search('', { status: 'completed', createdBy: user.name });
      let vals;
      if (col === 'date') vals = [...new Set(completed.map(t => extractDate(t.timestamp)).filter(Boolean))].sort().reverse();
      else if (col === 'branch') vals = [...new Set(completed.map(t => t.branch).filter(Boolean))].sort();
      else if (col === 'hoOrCo') vals = [...new Set(completed.map(t => t.hoOrCo).filter(Boolean))];
      else if (col === 'issueType') vals = [...new Set(completed.map(t => t.issueType).filter(Boolean))];
      else return;
      if (!vals.length) return;

      const currentArr = completedColFilters[col] || [];
      let selected = [...currentArr];

      const overlay = document.createElement('div');
      overlay.className = 'col-filter-overlay'; overlay.id = 'colFilterPopup';
      const labels = { date: 'Date', branch: 'Branch', hoOrCo: 'HO/CO', issueType: 'Issue Type' };
      overlay.innerHTML = `
        <div class="col-filter-modal">
          <div class="col-filter-header"><span>Filter: ${labels[col]}</span><button class="popup-close">✕</button></div>
          <div class="col-filter-list">
            <div class="col-filter-item ${selected.length === 0 ? 'selected' : ''}" data-val="__all__"><span class="check-mark">${selected.length === 0 ? '✓' : ''}</span><span>Show All</span></div>
            ${vals.map(v => `<div class="col-filter-item ${selected.includes(v) ? 'selected' : ''}" data-val="${esc(v)}"><span class="check-mark">${selected.includes(v) ? '✓' : ''}</span><span>${col === 'date' ? formatDateDMY(v) : esc(v)}</span></div>`).join('')}
          </div>
          <div class="col-filter-footer">
            <button class="btn-filter-clear">Show All</button>
            <button class="btn-filter-apply">Apply</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      function refreshChecks() {
        overlay.querySelectorAll('.col-filter-item').forEach(item => {
          const v = item.dataset.val;
          const isSelected = v === '__all__' ? selected.length === 0 : selected.includes(v);
          item.classList.toggle('selected', isSelected);
          item.querySelector('.check-mark').textContent = isSelected ? '✓' : '';
        });
      }

      overlay.querySelector('.popup-close').addEventListener('click', closeColFilterPopup);
      overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeColFilterPopup(); });
      overlay.querySelectorAll('.col-filter-item').forEach(item => {
        item.addEventListener('click', () => {
          const v = item.dataset.val;
          if (v === '__all__') { selected = []; }
          else {
            const idx = selected.indexOf(v);
            if (idx >= 0) selected.splice(idx, 1); else selected.push(v);
          }
          refreshChecks();
        });
      });
      overlay.querySelector('.btn-filter-clear').addEventListener('click', async () => {
        delete completedColFilters[col];
        th.classList.remove('filtered');
        closeColFilterPopup();
        await renderCompletedTable(); renderActiveFilterBar();
      });
      overlay.querySelector('.btn-filter-apply').addEventListener('click', async () => {
        if (selected.length > 0) completedColFilters[col] = [...selected]; else delete completedColFilters[col];
        th.classList.toggle('filtered', selected.length > 0);
        closeColFilterPopup();
        await renderCompletedTable(); renderActiveFilterBar();
      });
    });
  });

  document.addEventListener('click', (e) => { const p = $('colFilterPopup'); if (p && !p.contains(e.target) && !e.target.closest('.th-filterable')) closeColFilterPopup(); });

  function renderActiveFilterBar() {
    const keys = Object.keys(completedColFilters).filter(k => completedColFilters[k] && completedColFilters[k].length);
    if (!keys.length) { activeFilterBar.innerHTML = ''; return; }
    const labels = { date: 'Date', branch: 'Branch', hoOrCo: 'HO/CO', issueType: 'Issue Type' };
    activeFilterBar.innerHTML = keys.map(k => {
      const arr = completedColFilters[k];
      const display = arr.map(v => k === 'date' ? formatDateDMY(v) : v).join(', ');
      return `<span class="active-filter-tag">${labels[k]}: <strong>${esc(display)}</strong> <span class="filter-remove" data-remove="${k}">✕</span></span>`;
    }).join('') + '<span class="clear-all-filters" id="clearAllFilters">Clear all</span>';
    activeFilterBar.querySelectorAll('.filter-remove').forEach(el => {
      el.addEventListener('click', async () => { delete completedColFilters[el.dataset.remove]; const th = document.querySelector(`.th-filterable[data-col="${el.dataset.remove}"]`); if (th) th.classList.remove('filtered'); await renderCompletedTable(); renderActiveFilterBar(); });
    });
    const c = $('clearAllFilters'); if (c) c.addEventListener('click', async () => { completedColFilters = {}; document.querySelectorAll('.th-filterable').forEach(th => th.classList.remove('filtered')); await renderCompletedTable(); renderActiveFilterBar(); });
  }

  async function renderCompletedTable() {
    let tasks = await DataStore.search('', { status: 'completed', createdBy: user.name });
    Object.keys(completedColFilters).forEach(col => { const arr = completedColFilters[col]; if (!arr || !arr.length) return; tasks = tasks.filter(t => { if (col === 'branch') return arr.includes(t.branch); if (col === 'issueType') return arr.includes(t.issueType); if (col === 'hoOrCo') return arr.includes(t.hoOrCo); if (col === 'date') return t.timestamp && arr.includes(extractDate(t.timestamp)); return true; }); });
    renderActiveFilterBar();
    document.querySelectorAll('.th-filterable[data-col]').forEach(th => th.classList.toggle('filtered', !!(completedColFilters[th.dataset.col] && completedColFilters[th.dataset.col].length)));
    if (!tasks.length) { completedTableBody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-muted)">No completed tasks.</td></tr>'; return; }
    completedTableBody.innerHTML = tasks.map(t => {
      const tc = { Software: 'badge-primary', Hardware: 'badge-warning', Both: 'badge-info' }[t.issueType] || 'badge-gray';
      const hc = t.hoOrCo === 'HO' ? 'badge-danger' : 'badge-success';
      const approvalBadge = t.amountStatus === 'approved' ? '<span class="badge badge-success">Approved</span>' : t.amountStatus === 'pending' ? '<span class="badge badge-amount-pending">Pending</span>' : t.amountStatus === 'rejected' ? '<span class="badge badge-amount-rejected">Rejected</span>' : '—';
      return `<tr data-view="${t.taskId}"><td class="task-id-cell">${esc(t.taskId)}</td><td>${esc(formatDateDMY(extractDate(t.timestamp)))}</td><td>${esc(t.branch)}</td><td><span class="badge ${hc}">${esc(t.hoOrCo)}</span></td><td><span class="badge ${tc}">${esc(t.issueType)}</span></td><td>${esc(displayIssue(t))}</td><td>₹${(t.expectedAmount || t.amount || 0).toLocaleString('en-IN')}</td><td>${t.actualAmount != null ? '₹' + t.actualAmount.toLocaleString('en-IN') : '—'}</td><td>${approvalBadge}</td></tr>`;
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
      let tasks = await DataStore.search('', { status: 'inprogress', createdBy: user.name });
      if (quickFilterType) tasks = tasks.filter(t => t.issueType === quickFilterType);
      if (!tasks.length) { taskGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><h3>No in-progress ${quickFilterType || ''} tasks</h3><p>Click + to add a task.</p></div>`; return; }
      taskGrid.innerHTML = tasks.map(renderTaskCard).join('');
      taskGrid.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditSheet(b.dataset.edit)));
      taskGrid.querySelectorAll('[data-complete]').forEach(b => b.addEventListener('click', () => handleQuickComplete(b.dataset.complete)));
    }
  }

  function renderTaskCard(task) {
    const tb = { Software: 'badge-primary', Hardware: 'badge-warning', Both: 'badge-info' }[task.issueType] || 'badge-gray';
    const hb = task.hoOrCo === 'HO' ? 'badge-danger' : 'badge-success';
    const staff = task.staffName ? `<div class="task-field"><span class="task-field-label">Staff</span><span class="task-field-value">${esc(task.staffName)}${task.staffDesignation ? ' — ' + esc(task.staffDesignation) : ''}${task.staffId ? ' (' + esc(task.staffId) + ')' : ''}</span></div>` : '';
    const isApproved = task.amountStatus === 'approved';
    const isRejected = task.amountStatus === 'rejected';
    const isPending = task.amountStatus === 'pending';
    const statusBadge = isPending ? '<span class="badge badge-amount-pending">⏳ Awaiting Approval</span>' : isRejected ? '<span class="badge badge-amount-rejected">❌ Rejected</span>' : isApproved ? '<span class="badge badge-success">✅ Approved</span>' : '';
    const expAmt = task.expectedAmount || task.amount || 0;
    const amtField = expAmt > 0 ? `<div class="task-field"><span class="task-field-label">Expected Amount</span><span class="task-field-value">₹${expAmt.toLocaleString('en-IN')}</span></div>` : '';
    const rejNote = isRejected && task.amountRejectionNote ? `<div class="task-field"><span class="task-field-label" style="color:var(--danger)">Rejection Note</span><span class="task-field-value" style="color:var(--danger)">${esc(task.amountRejectionNote)}</span></div>` : '';
    const completeBtn = isApproved ? `<button class="btn btn-success btn-sm" data-complete="${task.taskId}">✅ Complete</button>` : '';
    return `<div class="task-card"><div class="task-status-bar${isPending ? ' pending' : isRejected ? ' rejected' : isApproved ? ' approved' : ''}"></div><div class="task-card-header"><div><div class="task-card-id">${esc(task.taskId)}</div><div class="task-card-badges" style="margin-top:5px"><span class="badge badge-warning">⏳ In Progress</span><span class="badge ${tb}">${esc(task.issueType)}</span><span class="badge ${hb}">${esc(task.hoOrCo)}</span>${statusBadge}</div></div></div><div class="task-card-body"><div class="task-field"><span class="task-field-label">Branch</span><span class="task-field-value">${esc(task.branch)}</span></div>${staff}<div class="task-field"><span class="task-field-label">Issue</span><span class="task-field-value truncate">${esc(displayIssue(task))}</span></div><div class="task-field"><span class="task-field-label">Solution</span><span class="task-field-value truncate">${esc(task.solution)}</span></div>${amtField}${rejNote}</div><div class="task-card-footer"><span class="task-timestamp">🕐 ${esc(task.timestamp)}</span><button class="btn btn-secondary btn-sm" data-edit="${task.taskId}">✏️ Edit</button>${completeBtn}</div></div>`;
  }

  async function handleQuickComplete(taskId) {
    const task = await DataStore.getById(taskId); if (!task) return;
    if (task.amountStatus !== 'approved') { showToast('Task must be approved by admin before completing.', 'warning'); return; }
    const expectedAmt = task.expectedAmount || task.amount || 0;
    showActualAmountDialog(expectedAmt, async (actualAmount) => {
      await DataStore.update(taskId, { completed: true, completedAt: formatDateTime(new Date()), actualAmount, amount: actualAmount });
      showToast('Completed!', 'success'); await renderAll();
    });
  }

  } // end staff view

  // ═══════════════════════════════════════════════════════════════════════════════
  // SHARED UTILS
  // ═══════════════════════════════════════════════════════════════════════════════
  // Keyboard: Escape closes modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('editOverlay') && $('editOverlay').classList.contains('open')) { $('editOverlay').classList.remove('open'); document.body.style.overflow = ''; }
      else if ($('viewOverlay').classList.contains('open')) { $('viewOverlay').classList.remove('open'); document.body.style.overflow = ''; }
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
    const staff = t.staffName ? `<div class="detail-field"><div class="detail-label">Staff</div><div class="detail-value">${esc(t.staffName)}${t.staffDesignation ? ' — ' + esc(t.staffDesignation) : ''}${t.staffId ? ' (' + esc(t.staffId) + ')' : ''}</div></div>` : '';
    const desc = t.detailedDescription ? `<div style="margin-top:14px"><div class="detail-label">Detailed Description</div><div class="detail-value" style="margin-top:4px;white-space:pre-wrap;max-height:180px;overflow-y:auto">${esc(t.detailedDescription)}</div></div>` : '';
    viewBody.innerHTML = `<div class="review-summary"><div class="detail-grid">
      <div class="detail-field"><div class="detail-label">Task ID</div><div class="detail-value mono">${esc(t.taskId)}</div></div>
      <div class="detail-field"><div class="detail-label">Date & Time</div><div class="detail-value">${esc(t.timestamp)}</div></div>
      <div class="detail-field"><div class="detail-label">Branch</div><div class="detail-value">${esc(t.branch)}</div></div>
      <div class="detail-field"><div class="detail-label">HO / CO</div><div class="detail-value">${esc(t.hoOrCo)}</div></div>
      ${staff}
      <div class="detail-field"><div class="detail-label">Issue Type</div><div class="detail-value">${esc(t.issueType)}</div></div>
      <div class="detail-field"><div class="detail-label">Expected Amount</div><div class="detail-value">₹${(t.expectedAmount || t.amount || 0).toLocaleString('en-IN')}</div></div>
      ${t.actualAmount != null ? `<div class="detail-field"><div class="detail-label">Actual Amount</div><div class="detail-value" style="font-weight:600">₹${t.actualAmount.toLocaleString('en-IN')}</div></div>` : ''}
      ${t.amountStatus && t.amountStatus !== 'none' ? `<div class="detail-field"><div class="detail-label">Approval</div><div class="detail-value">${t.amountStatus === 'approved' ? '✅ Approved' : t.amountStatus === 'pending' ? '⏳ Pending' : '❌ Rejected'}${t.amountReviewedBy ? ' by ' + esc(t.amountReviewedBy) : ''}${t.amountRejectionNote ? '<div style="font-size:0.8rem;color:var(--danger);margin-top:2px">Note: ' + esc(t.amountRejectionNote) + '</div>' : ''}</div></div>` : ''}
      <div class="detail-field"><div class="detail-label">Status</div><div class="detail-value">${t.completed ? '✅ Completed' : '⏳ In Progress'}</div></div>
      <div class="detail-field"><div class="detail-label">Created By</div><div class="detail-value">${esc(t.createdBy)}</div></div>
      ${t.completedAt ? `<div class="detail-field"><div class="detail-label">Completed At</div><div class="detail-value">${esc(t.completedAt)}</div></div>` : ''}
    </div><div style="margin-top:14px"><div class="detail-label">Issue</div><div class="detail-value" style="margin-top:4px">${esc(displayIssue(t))}</div></div>
    <div style="margin-top:14px"><div class="detail-label">Solution</div><div class="detail-value" style="margin-top:4px">${esc(t.solution)}</div></div>${desc}</div>`;
    viewOverlay.classList.add('open'); document.body.style.overflow = 'hidden';
  }

  function closeColFilterPopup() { const p = $('colFilterPopup'); if (p) p.remove(); }

  function esc(str) { if (!str && str !== 0) return ''; return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function extractDate(ts) {
    if (!ts) return '';
    return ts.includes('T') ? ts.split('T')[0] : ts.split(' ')[0];
  }

  function formatDateDMY(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : dateStr;
  }

  // Display issue: category + description (backward-compatible with old tasks)
  function displayIssue(task) {
    if (task.issueCategory && task.issueCategory !== 'Other') {
      return task.issueDescription ? `${task.issueCategory} — ${task.issueDescription}` : task.issueCategory;
    }
    return task.issueDescription || '';
  }

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
