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

    // --- CANCEL BUTTON FIX ---
    // This finds ANY button inside your modals that contains the word "Cancel"
    document.querySelectorAll('.modal .btn-outline, .modal button').forEach(btn => {
        if (btn.innerText.toLowerCase().includes('cancel')) {
            btn.onclick = (e) => {
                e.preventDefault();
                const modal = btn.closest('.modal');
                if (modal) modal.classList.remove('active');
            };
        }
    });
}

// --- DATABASE LOGIC ---

async function loadSemesters() {
    const { data } = await db.from('semesters2').select('*').order('created_at', { ascending: false });
    const select = $('semester-select');
    select.innerHTML = '<option value="">Select Semester</option>';
    data?.forEach(sem => select.innerHTML += `<option value="${sem.id}">${sem.name}</option>`);

    const saved = localStorage.getItem('selectedSemesterId');
    if (saved) {
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
        $('add-student-btn').style.display = 'none';
    } else {
        $('no-subjects-state').style.display = 'none';
        $('table-section').style.display = 'block';
        $('add-student-btn').style.display = 'flex';
        await loadStudents();
    }
}

async function loadStudents() {
    const { data: studentList } = await db.from('students2').select('*').eq('semester_id', currentSemesterId);
    if (!studentList?.length) {
        students = [];
        renderTable();
        return;
    }

    const ids = studentList.map(s => s.id);
    const { data: gradeData } = await db.from('grades2').select('*').in('student_id', ids);

    students = studentList.map(s => ({
        ...s,
        grades: (gradeData || []).filter(g => g.student_id === s.id)
    }));

    renderTable();
}

async function saveStudent() {
    const name = $('new-student-name').value.trim();
    if (!name) return showToast('Please enter a name', 'danger');

    const { data: student, error } = await db.from('students2').insert([{ 
        full_name: name, 
        semester_id: currentSemesterId,
        year_level: $('new-student-year').value,
        section: $('new-student-section').value
    }]).select().single();

    if (!error && student) {
        const gradeInputs = document.querySelectorAll('.subject-grade-input');
        const grades = [];
        gradeInputs.forEach((input, index) => {
            if (input.value !== '') {
                grades.push({
                    student_id: student.id,
                    subject_id: subjects[index].id,
                    score: parseFloat(input.value)
                });
            }
        });

        if (grades.length > 0) await db.from('grades2').insert(grades);

        closeModal('student-modal');
        showToast('Student saved successfully', 'success');
        loadStudents();
        // Reset form
        $('new-student-name').value = '';
    }
}

async function updateGrade(sid, subid, val) {
    const score = val === '' ? null : parseFloat(val);
    await db.from('grades2').upsert({ student_id: sid, subject_id: subid, score: score }, { onConflict: 'student_id,subject_id' });
    loadStudents();
}

// --- UI & RENDERING ---

function renderTable() {
    const head = $('table-header');
    const body = $('table-body');
    
    // UI Improvement: Sleek headers
    head.innerHTML = '<th class="text-left">Student Information</th>';
    subjects.forEach(sub => head.innerHTML += `<th class="text-center">${sub.name}</th>`);
    head.innerHTML += '<th class="text-center">GWA</th><th class="text-center">Action</th>';

    body.innerHTML = '';
    const subjectSums = subjects.map(() => 0);
    const subjectCounts = subjects.map(() => 0);

    students.forEach(s => {
        let row = `<tr>
            <td>
                <div class="student-info">
                    <span class="student-name">${s.full_name}</span>
                    <span class="student-meta">${s.year_level || ''} - ${s.section || ''}</span>
                </div>
            </td>`;
        
        let total = 0, count = 0;
        subjects.forEach((sub, idx) => {
            const g = s.grades.find(g => g.subject_id === sub.id);
            const val = (g && g.score !== null) ? g.score : '';
            if (val !== '') { total += parseFloat(val); count++; subjectSums[idx] += parseFloat(val); subjectCounts[idx]++; }
            
            row += `<td class="text-center">
                <input type="number" class="table-input" value="${val}" onchange="updateGrade('${s.id}', '${sub.id}', this.value)">
            </td>`;
        });

        const gwa = count > 0 ? (total / count).toFixed(1) : '0.0';
        row += `<td class="text-center"><span class="badge ${gwa >= 75 ? 'pass' : 'fail'}">${gwa}</span></td>`;
        row += `<td class="text-center"><button class="btn-icon delete" onclick="deleteStudent('${s.id}')"><i class="fa-solid fa-trash-can"></i></button></td></tr>`;
        body.innerHTML += row;
    });

    updateStats(subjectSums, subjectCounts);
}

function updateStats(sums, counts) {
    $('stat-total-students').textContent = students.length;
    const allGrades = sums.reduce((a, b) => a + b, 0);
    const allCounts = counts.reduce((a, b) => a + b, 0);
    $('stat-average-class').textContent = allCounts ? (allGrades / allCounts).toFixed(1) : '0.0';
    
    updateChart(subjects.map(s => s.name), subjects.map((s, i) => counts[i] ? (sums[i] / counts[i]).toFixed(1) : 0));
}

// --- UTILITIES ---

function openAddStudentModal() {
    const container = $('grade-inputs');
    if (container) {
        container.innerHTML = `<label style="grid-column: 1/-1; margin-top: 10px; font-weight: 600;">Subject Grades</label>`;
        subjects.forEach(sub => {
            container.innerHTML += `
                <div class="grade-input-field">
                    <span>${sub.name}</span>
                    <input type="number" class="subject-grade-input" placeholder="0.0">
                </div>
            `;
        });
    }
    openModal('student-modal');
}

async function addSemester() {
    const name = $('semester-name').value.trim();
    if (!name) return;
    await db.from('semesters2').insert([{ name }]);
    $('semester-name').value = '';
    closeModal('semester-modal');
    loadSemesters();
}

async function addSubject() {
    const name = $('new-subject-name').value.trim();
    if (!name) return;
    await db.from('subjects2').insert([{ name, semester_id: currentSemesterId }]);
    $('new-subject-name').value = '';
    closeModal('subject-modal');
    loadDashboard();
}

async function deleteStudent(id) {
    if (confirm("Are you sure you want to remove this student?")) {
        await db.from('students2').delete().eq('id', id);
        loadStudents();
    }
}

function renderSubjectList() {
    const wrapper = $('subject-list');
    wrapper.innerHTML = subjects.map(s => `<div class="subj-pill">${s.name}</div>`).join('');
}

function openModal(id) { $(id).classList.add('active'); }
function closeModal(id) { $(id).classList.remove('active'); }

function initChart() {
    const ctx = $('dashboard-chart').getContext('2d');
    dashboardChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'Average Score', data: [], backgroundColor: '#800000', borderRadius: 5 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } }
    });
}

function updateChart(labels, data) {
    if (!dashboardChart) return;
    dashboardChart.data.labels = labels;
    dashboardChart.data.datasets[0].data = data;
    dashboardChart.update();
}

function showToast(msg, type) {
    const t = document.createElement('div');
    t.className = `toast-notif ${type}`;
    t.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-check-circle' : 'fa-triangle-exclamation'}"></i> ${msg}`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 3000);
}