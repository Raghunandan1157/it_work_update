// data.js - Data management module (Supabase backend)

const BRANCHES = []; // loaded from DB via loadBranches()

async function loadBranches() {
  const { data } = await db
    .from('it_solutions_branches')
    .select('name')
    .eq('is_active', true);
  BRANCHES.length = 0;
  if (data) data.forEach(b => BRANCHES.push(b.name));
}

const STAFF_LIST = [
  { id: 'S001', name: 'Arun Kumar' },
  { id: 'S002', name: 'Priya Nair' },
  { id: 'S003', name: 'Rahul Sharma' },
  { id: 'S004', name: 'Sneha Menon' },
  { id: 'S005', name: 'Vijay Pillai' },
  { id: 'S006', name: 'Anitha Raj' },
  { id: 'S007', name: 'Manoj Das' },
  { id: 'S008', name: 'Divya George' },
  { id: 'S009', name: 'Suresh Babu' },
  { id: 'S010', name: 'Lakshmi Iyer' },
];

function generateTaskId() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `TASK-${datePart}-${timePart}`;
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
    issue_type: task.issueType,
    issue_description: task.issueDescription,
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
    issueType: row.issue_type,
    issueDescription: row.issue_description,
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
    if (updates.issueType !== undefined)           dbUpdates.issue_type = updates.issueType;
    if (updates.issueDescription !== undefined)    dbUpdates.issue_description = updates.issueDescription;
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

    q = q.order('created_at', { ascending: false });

    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async getStats() {
    // Run all count queries in parallel for efficiency
    const [
      { count: total },
      { count: inProgress },
      { count: completed },
      { count: software },
      { count: hardware },
      { count: both },
    ] = await Promise.all([
      db.from('it_solutions_tasks').select('*', { count: 'exact', head: true }),
      db.from('it_solutions_tasks').select('*', { count: 'exact', head: true }).eq('completed', false),
      db.from('it_solutions_tasks').select('*', { count: 'exact', head: true }).eq('completed', true),
      db.from('it_solutions_tasks').select('*', { count: 'exact', head: true }).eq('issue_type', 'Software'),
      db.from('it_solutions_tasks').select('*', { count: 'exact', head: true }).eq('issue_type', 'Hardware'),
      db.from('it_solutions_tasks').select('*', { count: 'exact', head: true }).eq('issue_type', 'Both'),
    ]);

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
