const SUPABASE_URL = 'https://bjcqygaqqgknplzjbmiw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqY3F5Z2FxcWdrbnBsempibWl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDQ4NzMsImV4cCI6MjA4ODYyMDg3M30._I5BxEMAK7PtHc87fGhmlPJf31H3j525NqNoUjAgwR8'; 
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentSemesterId = null;
let subjects = [];
let students = [];
let dashboardChart = null;

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
    loadSemesters();
    initChart();
    bindEvents();
});

function bindEvents() {
    $('sidebar-open-btn').onclick = () => $('sidebar').classList.add('open');
    $('sidebar-overlay').onclick = () => $('sidebar').classList.remove('open');
    
    $('semester-select').onchange = (e) => {
        currentSemesterId = e.target.value;
        localStorage.setItem('selectedSemesterId', currentSemesterId || '');
        loadDashboard();
    };

    $('add-semester-btn').onclick = () => openModal('semester-modal');
    $('save-semester-btn').onclick = addSemester;
    $('add-subject-btn').onclick = () => openModal('subject-modal');
    $('save-subject-btn').onclick = addSubject;
    
    $('add-student-btn').onclick = openAddStudentModal;
    $('save-student-btn').onclick = saveStudent;
}

// --- DATABASE FUNCTIONS ---

async function loadSemesters() {
    const { data, error } = await db.from('semesters2').select('*').order('created_at', { ascending: false });
    if (error) return showToast('Error loading semesters', 'danger');
    
    const select = $('semester-select');
    select.innerHTML = '<option value="">Select Semester</option>';
    data.forEach(sem => select.innerHTML += `<option value="${sem.id}">${sem.name}</option>`);

    const saved = localStorage.getItem('selectedSemesterId');
    if (saved && data.find(s => s.id === saved)) {
        select.value = saved;
        currentSemesterId = saved;
        loadDashboard();
    }
}

async function loadDashboard() {
    if (!currentSemesterId) {
        $('empty-state').style.display = 'flex';
        $('table-section').style.display = 'none';
        return;
    }
    
    $('empty-state').style.display = 'none';
    const { data: subData } = await db.from('subjects2').select('*').eq('semester_id', currentSemesterId);
    subjects = subData || [];
    
    renderSubjectList();
    
    if (subjects.length === 0) {
        $('no-subjects-state').style.display = 'flex';
        $('table-section').style.display = 'none';
    } else {
        $('no-subjects-state').style.display = 'none';
        $('table-section').style.display = 'block';
        await loadStudents();
    }
}

async function loadStudents() {
    const { data: studentList, error } = await db.from('students2').select('*').eq('semester_id', currentSemesterId);
    if (error) return;

    const ids = studentList.map(s => s.id);
    const { data: gradeData } = await db.from('grades2').select('*').in('student_id', ids);

    students = studentList.map(s => ({
        ...s,
        grades: (gradeData || []).filter(g => g.student_id === s.id)
    }));

    renderTable();
}

// --- CORE GRADING LOGIC (FIXED) ---

async function updateGrade(sid, subid, val) {
    const score = val === '' ? null : parseFloat(val);

    // This UPSERT requires the UNIQUE(student_id, subject_id) constraint in SQL
    const { error } = await db
        .from('grades2')
        .upsert(
            { student_id: sid, subject_id: subid, score: score }, 
            { onConflict: 'student_id,subject_id' }
        );

    if (error) {
        console.error('Save Error:', error);
        showToast('Save Failed: ' + error.message, 'danger');
    } else {
        // Subtle feedback: Update calculations without full reload for speed
        calculateStatsLocally(sid, subid, score);
        showToast('Grade saved', 'success');
    }
}

function calculateStatsLocally(sid, subid, newScore) {
    // Update local data array so chart reflects change instantly
    const student = students.find(s => s.id === sid);
    if (student) {
        let gradeObj = student.grades.find(g => g.subject_id === subid);
        if (gradeObj) gradeObj.score = newScore;
        else student.grades.push({ student_id: sid, subject_id: subid, score: newScore });
    }
    renderTable(); // Re-renders stats and chart
}

// --- UI RENDERING ---

function renderTable() {
    const head = $('table-header');
    const body = $('table-body');
    
    head.innerHTML = '<th>Student Name</th><th>Year & Sec</th>';
    subjects.forEach(sub => head.innerHTML += `<th>${sub.name}</th>`);
    head.innerHTML += '<th>GWA</th><th>Action</th>';

    body.innerHTML = '';
    const subjectSums = subjects.map(() => 0);
    const subjectCounts = subjects.map(() => 0);

    students.forEach(s => {
        let row = `<tr><td><strong>${s.full_name}</strong></td><td>${s.year_level || ''}-${s.section || ''}</td>`;
        let total = 0;
        let count = 0;

        subjects.forEach((sub, idx) => {
            const g = s.grades.find(g => g.subject_id === sub.id);
            const val = (g && g.score !== null) ? g.score : '';
            
            if (val !== '') {
                total += parseFloat(val);
                count++;
                subjectSums[idx] += parseFloat(val);
                subjectCounts[idx]++;
            }
            row += `<td><input type="number" class="glass-input-table" value="${val}" onchange="updateGrade('${s.id}', '${sub.id}', this.value)"></td>`;
        });

        const gwa = count > 0 ? (total / count).toFixed(1) : '0.0';
        row += `<td style="font-weight:bold; color:${gwa >= 75 ? '#27ae60' : '#e74c3c'}">${gwa}</td>`;
        row += `<td><button class="btn btn-sm btn-outline" onclick="deleteStudent('${s.id}')"><i class="fa-solid fa-trash"></i></button></td></tr>`;
        body.innerHTML += row;
    });

    updateDashboardStats(subjectSums, subjectCounts);
}

function updateDashboardStats(sums, counts) {
    // Update Chart
    const labels = subjects.map(s => s.name);
    const averages = subjects.map((s, i) => counts[i] ? (sums[i] / counts[i]).toFixed(1) : 0);
    updateChart(labels, averages);

    // Update Top Cards
    $('stat-total-students').textContent = students.length;
    const allGrades = sums.reduce((a, b) => a + b, 0);
    const allCounts = counts.reduce((a, b) => a + b, 0);
    $('stat-average-class').textContent = allCounts ? (allGrades / allCounts).toFixed(1) : '0.0';
}

// --- HELPERS ---

async function addSemester() {
    const name = $('semester-name').value.trim();
    if (!name) return;
    await db.from('semesters2').insert([{ name }]);
    closeModal('semester-modal');
    loadSemesters();
}

async function addSubject() {
    const name = $('new-subject-name').value.trim();
    if (!name) return;
    await db.from('subjects2').insert([{ name, semester_id: currentSemesterId }]);
    closeModal('subject-modal');
    loadDashboard();
}

async function saveStudent() {
    const name = $('new-student-name').value.trim();
    if (!name) return;
    const { data } = await db.from('students2').insert([{ 
        full_name: name, 
        semester_id: currentSemesterId,
        year_level: $('new-student-year').value,
        section: $('new-student-section').value
    }]).select().single();
    
    closeModal('student-modal');
    loadStudents();
}

async function deleteStudent(id) {
    if (confirm("Permanently delete this student?")) {
        await db.from('students2').delete().eq('id', id);
        loadStudents();
    }
}

function initChart() {
    const ctx = $('dashboard-chart').getContext('2d');
    dashboardChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'Avg', data: [], backgroundColor: '#800000' }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
}

function updateChart(labels, data) {
    if (!dashboardChart) return;
    dashboardChart.data.labels = labels;
    dashboardChart.data.datasets[0].data = data;
    dashboardChart.update();
}

function openModal(id) { $(id).classList.add('active'); }
function closeModal(id) { $(id).classList.remove('active'); }
function openAddStudentModal() { openModal('student-modal'); }

function showToast(msg, type) {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    $('toast-container').appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

function renderSubjectList() {
    const wrapper = $('subject-list');
    wrapper.innerHTML = subjects.map(s => `<div class="subject-item"><i class="fa-solid fa-book"></i> ${s.name}</div>`).join('');
}