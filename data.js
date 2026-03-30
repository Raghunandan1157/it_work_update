// data.js - Data management module (Supabase backend)

const BRANCHES = []; // loaded from employees table (unique locations)
const EMPLOYEES = []; // loaded from employees table

async function loadBranches() {
  const { data } = await db
    .from('employees')
    .select('location');
  BRANCHES.length = 0;
  if (data) {
    const unique = [...new Set(data.map(e => e.location).filter(Boolean))].sort();
    unique.forEach(b => BRANCHES.push(b));
  }
}

async function loadEmployees() {
  const { data } = await db
    .from('employees')
    .select('emp_id, name, location')
    .order('name');
  EMPLOYEES.length = 0;
  if (data) data.forEach(e => EMPLOYEES.push(e));
}

function getEmployeesByLocation(location) {
  return EMPLOYEES.filter(e => e.location === location);
}

const NMSPL_BRANCHES = [];
const NMSPL_EMPLOYEES = [];

async function loadNmsplBranches() {
  const { data } = await db
    .from('nmspl_employees')
    .select('location');
  NMSPL_BRANCHES.length = 0;
  if (data) {
    const unique = [...new Set(data.map(e => e.location).filter(Boolean))].sort();
    unique.forEach(b => NMSPL_BRANCHES.push(b));
  }
}

async function loadNmsplEmployees() {
  const { data } = await db
    .from('nmspl_employees')
    .select('emp_id, name, location')
    .order('name');
  NMSPL_EMPLOYEES.length = 0;
  if (data) data.forEach(e => NMSPL_EMPLOYEES.push(e));
}

function getNmsplEmployeesByLocation(location) {
  return NMSPL_EMPLOYEES.filter(e => e.location === location);
}

// Issue history (autocomplete from DB)
const IssueHistory = {
  async get(userId, category) {
    let q = db
      .from('it_solutions_issue_history')
      .select('issue_text')
      .eq('user_id', userId)
      .order('used_at', { ascending: false })
      .limit(100);
    if (category) q = q.eq('issue_category', category);
    const { data } = await q;
    return data ? data.map(r => r.issue_text) : [];
  },

  async save(userId, text, category) {
    if (!text || !text.trim()) return;
    const trimmed = text.trim();
    // Remove old duplicate if exists, then insert fresh
    let delQ = db
      .from('it_solutions_issue_history')
      .delete()
      .eq('user_id', userId)
      .ilike('issue_text', trimmed);
    if (category) delQ = delQ.eq('issue_category', category);
    await delQ;
    const row = { user_id: userId, issue_text: trimmed };
    if (category) row.issue_category = category;
    await db
      .from('it_solutions_issue_history')
      .insert(row);
  }
};

async function generateTaskId() {
  const { data } = await db
    .from('it_solutions_tasks')
    .select('task_id')
    .order('created_at', { ascending: false })
    .limit(1);
  const last = data && data.length ? parseInt(data[0].task_id, 10) : 0;
  return String((isNaN(last) ? 0 : last) + 1);
}

function formatDateTime(date) {
  if (!date) return '';
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Convert JS camelCase task object → DB snake_case row
function toDb(task) {
  return {
    task_id: task.taskId,
    timestamp: task.timestamp,
    branch: task.branch,
    ho_or_co: task.hoOrCo,
    staff_name: task.staffName || null,
    staff_id: task.staffId || null,
    staff_designation: task.staffDesignation || null,
    issue_type: task.issueType,
    issue_description: task.issueDescription,
    issue_category: task.issueCategory || null,
    solution: task.solution,
    detailed_description: task.detailedDescription || null,
    amount: task.amount || 0,
    completed: task.completed || false,
    completed_at: task.completedAt || null,
    created_by: task.createdBy
  };
}

// Convert DB snake_case row → JS camelCase task object
function fromDb(row) {
  return {
    taskId: row.task_id,
    timestamp: row.timestamp,
    branch: row.branch,
    hoOrCo: row.ho_or_co,
    staffName: row.staff_name,
    staffId: row.staff_id,
    staffDesignation: row.staff_designation,
    issueType: row.issue_type,
    issueDescription: row.issue_description,
    issueCategory: row.issue_category || null,
    solution: row.solution,
    detailedDescription: row.detailed_description,
    amount: row.amount,
    completed: row.completed,
    completedAt: row.completed_at,
    createdBy: row.created_by
  };
}

const DataStore = {
  async getAll() {
    const { data, error } = await db
      .from('it_solutions_tasks')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async add(task) {
    const { data, error } = await db
      .from('it_solutions_tasks')
      .insert(toDb(task))
      .select()
      .single();
    if (error) throw error;
    return fromDb(data);
  },

  async update(taskId, updates) {
    // Map any camelCase keys in updates to snake_case
    const dbUpdates = {};
    if (updates.taskId !== undefined)              dbUpdates.task_id = updates.taskId;
    if (updates.timestamp !== undefined)           dbUpdates.timestamp = updates.timestamp;
    if (updates.branch !== undefined)              dbUpdates.branch = updates.branch;
    if (updates.hoOrCo !== undefined)              dbUpdates.ho_or_co = updates.hoOrCo;
    if (updates.staffName !== undefined)           dbUpdates.staff_name = updates.staffName;
    if (updates.staffId !== undefined)             dbUpdates.staff_id = updates.staffId;
    if (updates.staffDesignation !== undefined)    dbUpdates.staff_designation = updates.staffDesignation;
    if (updates.issueType !== undefined)           dbUpdates.issue_type = updates.issueType;
    if (updates.issueDescription !== undefined)    dbUpdates.issue_description = updates.issueDescription;
    if (updates.issueCategory !== undefined)       dbUpdates.issue_category = updates.issueCategory;
    if (updates.solution !== undefined)            dbUpdates.solution = updates.solution;
    if (updates.detailedDescription !== undefined) dbUpdates.detailed_description = updates.detailedDescription;
    if (updates.amount !== undefined)              dbUpdates.amount = updates.amount;
    if (updates.completed !== undefined)           dbUpdates.completed = updates.completed;
    if (updates.completedAt !== undefined)         dbUpdates.completed_at = updates.completedAt;
    if (updates.createdBy !== undefined)           dbUpdates.created_by = updates.createdBy;

    const { data, error } = await db
      .from('it_solutions_tasks')
      .update(dbUpdates)
      .eq('task_id', taskId)
      .select()
      .single();
    if (error) throw error;
    return fromDb(data);
  },

  async delete(taskId) {
    const { error } = await db
      .from('it_solutions_tasks')
      .delete()
      .eq('task_id', taskId);
    if (error) throw error;
  },

  async getById(taskId) {
    const { data, error } = await db
      .from('it_solutions_tasks')
      .select('*')
      .eq('task_id', taskId)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null; // row not found
      throw error;
    }
    return fromDb(data);
  },

  async search(query, filters = {}) {
    let q = db.from('it_solutions_tasks').select('*');

    if (query) {
      // ilike search across the main text columns using Supabase's or() filter
      const pattern = `%${query}%`;
      q = q.or(
        [
          `task_id.ilike.${pattern}`,
          `issue_description.ilike.${pattern}`,
          `solution.ilike.${pattern}`,
          `detailed_description.ilike.${pattern}`,
          `staff_name.ilike.${pattern}`,
          `staff_id.ilike.${pattern}`,
          `staff_designation.ilike.${pattern}`,
          `branch.ilike.${pattern}`,
        ].join(',')
      );
    }

    if (filters.status === 'inprogress') {
      q = q.eq('completed', false);
    } else if (filters.status === 'completed') {
      q = q.eq('completed', true);
    }

    if (filters.issueType) {
      q = q.eq('issue_type', filters.issueType);
    }

    if (filters.branch) {
      q = q.eq('branch', filters.branch);
    }

    if (filters.hoOrCo) {
      q = q.eq('ho_or_co', filters.hoOrCo);
    }

    if (filters.createdBy) {
      q = q.eq('created_by', filters.createdBy);
    }

    q = q.order('created_at', { ascending: false });

    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async getStats(createdBy) {
    // Run all count queries in parallel for efficiency
    let qTotal = db.from('it_solutions_tasks').select('*', { count: 'exact', head: true });
    let qInProgress = db.from('it_solutions_tasks').select('*', { count: 'exact', head: true }).eq('completed', false);
    let qCompleted = db.from('it_solutions_tasks').select('*', { count: 'exact', head: true }).eq('completed', true);
    let qSoftware = db.from('it_solutions_tasks').select('*', { count: 'exact', head: true }).eq('issue_type', 'Software').eq('completed', false);
    let qHardware = db.from('it_solutions_tasks').select('*', { count: 'exact', head: true }).eq('issue_type', 'Hardware').eq('completed', false);
    let qBoth = db.from('it_solutions_tasks').select('*', { count: 'exact', head: true }).eq('issue_type', 'Both').eq('completed', false);

    if (createdBy) {
      qTotal = qTotal.eq('created_by', createdBy);
      qInProgress = qInProgress.eq('created_by', createdBy);
      qCompleted = qCompleted.eq('created_by', createdBy);
      qSoftware = qSoftware.eq('created_by', createdBy);
      qHardware = qHardware.eq('created_by', createdBy);
      qBoth = qBoth.eq('created_by', createdBy);
    }

    const [
      { count: total },
      { count: inProgress },
      { count: completed },
      { count: software },
      { count: hardware },
      { count: both },
    ] = await Promise.all([qTotal, qInProgress, qCompleted, qSoftware, qHardware, qBoth]);

    return {
      total: total || 0,
      inProgress: inProgress || 0,
      completed: completed || 0,
      software: software || 0,
      hardware: hardware || 0,
      both: both || 0,
    };
  }
};
