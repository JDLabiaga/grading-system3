const SUPABASE_URL = 'https://bjcqygaqqgknplzjbmiw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; // Use your full key
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = { id: '00000000-0000-0000-0000-000000000000' };
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
    $('sidebar-collapse-btn').onclick = () => $('sidebar').classList.toggle('collapsed');
    $('sidebar-open-btn').onclick = () => $('sidebar').classList.add('open');
    $('sidebar-overlay').onclick = () => $('sidebar').classList.remove('open');
    
    $('semester-select').onchange = (e) => {
        currentSemesterId = e.target.value;
        loadDashboard();
    };

    $('add-semester-btn').onclick = () => openModal('semester-modal');
    $('save-semester-btn').onclick = addSemester;
    $('add-subject-btn').onclick = () => openModal('subject-modal');
    $('save-subject-btn').onclick = addSubject;
    $('add-student-btn').onclick = openAddStudentModal;
    $('save-student-btn').onclick = saveStudent;
}

async function loadSemesters() {
    const { data } = await db.from('semesters').select('*').order('created_at', { ascending: false });
    const select = $('semester-select');
    select.innerHTML = '<option value="">Select Semester</option>';
    data?.forEach(sem => {
        select.innerHTML += `<option value="${sem.id}">${sem.name}</option>`;
    });
}

async function loadDashboard() {
    if (!currentSemesterId) {
        $('empty-state').style.display = 'flex';
        $('table-section').style.display = 'none';
        return;
    }
    
    $('empty-state').style.display = 'none';
    const { data: subData } = await db.from('subjects').select('*').eq('semester_id', currentSemesterId);
    subjects = subData || [];
    
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
    const { data: studentList } = await db.from('students').select('*').eq('semester_id', currentSemesterId);
    const { data: gradeData } = await db.from('grades').select('*').in('student_id', studentList.map(s => s.id));
    
    students = studentList.map(s => ({
        ...s,
        grades: gradeData.filter(g => g.student_id === s.id)
    }));
    renderTable();
    // Update dashboard chart & stats
    try {
        const labels = subjects.map(s => s.name);
        const averages = subjects.map(s => {
            let total = 0, count = 0;
            students.forEach(st => {
                const g = st.grades.find(x => x.subject_id === s.id);
                if (g) { total += g.score; count++; }
            });
            return count ? parseFloat((total / count).toFixed(1)) : 0;
        });

        // Class average and pass rate
        const studentAverages = students.map(st => {
            if (subjects.length === 0) return 0;
            const total = subjects.reduce((acc, sub) => acc + (st.grades.find(g => g.subject_id === sub.id)?.score || 0), 0);
            return total / subjects.length;
        });
        const totalStudents = students.length;
        const classAvg = totalStudents ? (studentAverages.reduce((a,b)=>a+b,0)/totalStudents).toFixed(1) : 0;
        const passCount = studentAverages.filter(a => a >= 75).length;
        const passRate = totalStudents ? Math.round((passCount / totalStudents) * 100) : 0;

        // Update DOM stats
        document.getElementById('stat-total-students').textContent = totalStudents;
        document.getElementById('stat-average-class').textContent = classAvg;
        document.getElementById('stat-pass-rate').textContent = passRate + '%';

        updateChart(labels, averages);
    } catch (e) {
        console.warn('Chart update skipped', e);
    }
}

function initChart() {
    const el = document.getElementById('dashboard-chart');
    if (!el) return;
    const ctx = el.getContext('2d');
    dashboardChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Average Score',
                data: [],
                backgroundColor: 'rgba(59,130,246,0.85)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, max: 100 }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function updateChart(labels, data) {
    if (!dashboardChart) return;
    dashboardChart.data.labels = labels;
    dashboardChart.data.datasets[0].data = data;
    dashboardChart.update();
}

function renderTable() {
    const head = $('table-header');
    const body = $('table-body');
    
    head.innerHTML = '<th>Name</th><th>Year/Sec</th>';
    subjects.forEach(sub => head.innerHTML += `<th>${sub.name}</th>`);
    head.innerHTML += '<th>Avg</th><th>Action</th>';
    
    body.innerHTML = '';
    students.forEach(s => {
        let row = `<tr><td>${s.full_name}</td><td>${s.year_level}-${s.section}</td>`;
        let total = 0;
        subjects.forEach(sub => {
            const grade = s.grades.find(g => g.subject_id === sub.id)?.score || 0;
            total += grade;
            row += `<td><input type="number" class="glass-input-table" value="${grade}" onchange="updateGrade(${s.id}, ${sub.id}, this.value)"></td>`;
        });
        const avg = (total / subjects.length).toFixed(1);
        row += `<td style="font-weight:bold; color:${avg >= 75 ? 'green':'red'}">${avg}</td>`;
        row += `<td><button class="btn btn-sm btn-outline" onclick="deleteStudent(${s.id})"><i class="fa-solid fa-trash"></i></button></td></tr>`;
        body.innerHTML += row;
    });
}

// Helper: Modals
function openModal(id) { $(id).classList.add('active'); }
function closeModal(id) { $(id).classList.remove('active'); }
document.querySelectorAll('[data-close]').forEach(el => {
    // If the element is the overlay, only close when the overlay itself is clicked (prevent inner clicks from closing)
    if (el.classList.contains('modal-overlay')) {
        el.addEventListener('click', (e) => {
            if (e.target === el) closeModal(el.dataset.close);
        });
    } else {
        el.addEventListener('click', () => closeModal(el.dataset.close));
    }
});

// Autofocus inputs when opening modal (useful for semester creation)
const _openModal = openModal;
function openModal(id) {
    _openModal(id);
    try {
        const overlay = $(id);
        const modal = overlay && overlay.querySelector('.modal');
        if (modal) {
            const input = modal.querySelector('input, textarea, select');
            if (input) input.focus();
        }
    } catch (e) { /* ignore */ }
}

async function addSemester() {
    const name = $('semester-name').value;
    await db.from('semesters').insert([{ name }]);
    location.reload();
}

async function addSubject() {
    const name = $('new-subject-name').value;
    await db.from('subjects').insert([{ name, semester_id: currentSemesterId }]);
    loadDashboard();
    closeModal('subject-modal');
}

async function saveStudent() {
    const name = $('new-student-name').value;
    const { data } = await db.from('students').insert([{ 
        full_name: name, 
        semester_id: currentSemesterId,
        year_level: $('new-student-year').value,
        section: $('new-student-section').value
    }]).select().single();
    
    // Add default grades
    const grades = subjects.map(sub => ({ student_id: data.id, subject_id: sub.id, score: 0 }));
    await db.from('grades').insert(grades);
    
    closeModal('student-modal');
    loadStudents();
}

async function updateGrade(sid, subid, val) {
    await db.from('grades').update({ score: parseFloat(val) }).match({ student_id: sid, subject_id: subid });
    loadStudents(); // Refresh average
}

async function deleteStudent(id) {
    if(confirm("Delete student?")) {
        await db.from('students').delete().eq('id', id);
        loadStudents();
    }
}

function openAddStudentModal() {
    $('grade-inputs').innerHTML = '';
    subjects.forEach(sub => {
        $('grade-inputs').innerHTML += `<div class="input-group"><span>${sub.name}</span><input type="number" value="0"></div>`;
    });
    openModal('student-modal');
}