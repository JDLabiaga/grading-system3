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

    // --- FINAL CANCEL BUTTON FIX ---
    // Using a global listener so it works even if the button is re-rendered
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (btn && btn.innerText.toLowerCase().includes('cancel')) {
            e.preventDefault();
            const modal = btn.closest('.modal') || btn.closest('[id$="-modal"]');
            if (modal) modal.classList.remove('active');
        }
    });
}

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
        // Collect grades from the dynamic inputs in the modal
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
        showToast('Student & Grades saved!', 'success');
        loadStudents();
        $('new-student-name').value = '';
    }
}

async function updateGrade(sid, subid, val) {
    const score = val === '' ? null : parseFloat(val);
    await db.from('grades2').upsert({ student_id: sid, subject_id: subid, score: score }, { onConflict: 'student_id,subject_id' });
    loadStudents();
}

function renderTable() {
    const head = $('table-header');
    const body = $('table-body');
    
    head.innerHTML = '<th style="text-align:left; padding-left:20px;">Student Information</th>';
    subjects.forEach(sub => head.innerHTML += `<th class="text-center">${sub.name}</th>`);
    head.innerHTML += '<th class="text-center">GWA</th><th class="text-center">Action</th>';

    body.innerHTML = '';
    const subjectSums = subjects.map(() => 0);
    const subjectCounts = subjects.map(() => 0);

    students.forEach(s => {
        let row = `<tr>
            <td style="padding-left:20px;">
                <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:600; color:#111;">${s.full_name}</span>
                    <span style="font-size:0.75rem; color:#666;">${s.year_level || ''} ${s.section || ''}</span>
                </div>
            </td>`;
        
        let total = 0, count = 0;
        subjects.forEach((sub, idx) => {
            const g = s.grades.find(g => g.subject_id === sub.id);
            const val = (g && g.score !== null) ? g.score : '';
            if (val !== '') { total += parseFloat(val); count++; subjectSums[idx] += parseFloat(val); subjectCounts[idx]++; }
            
            row += `<td class="text-center">
                <input type="number" class="table-input" value="${val}" style="width:50px; text-align:center; border:1px solid #ddd; border-radius:4px;" onchange="updateGrade('${s.id}', '${sub.id}', this.value)">
            </td>`;
        });

        const gwa = count > 0 ? (total / count).toFixed(1) : '0.0';
        row += `<td class="text-center"><span style="font-weight:bold; color:${gwa >= 75 ? '#155724' : '#721c24'}">${gwa}</span></td>`;
        row += `<td class="text-center"><button class="btn-icon" onclick="deleteStudent('${s.id}')" style="background:none; border:none; cursor:pointer; color:#999;"><i class="fa-solid fa-trash-can"></i></button></td></tr>`;
        body.innerHTML += row;
    });

    $('stat-total-students').textContent = students.length;
    updateChart(subjects.map(s => s.name), subjects.map((s, i) => subjectCounts[i] ? (subjectSums[i] / subjectCounts[i]).toFixed(1) : 0));
}

function openAddStudentModal() {
    const container = $('grade-inputs');
    if (container) {
        container.innerHTML = `<label style="grid-column: 1/-1; margin: 10px 0 5px; font-weight: 600; font-size: 0.85rem; color:#555;">Initial Grades</label>`;
        subjects.forEach(sub => {
            container.innerHTML += `
                <div style="display:flex; justify-content:space-between; align-items:center; padding: 5px 0; border-bottom:1px solid #f0f0f0;">
                    <span style="font-size:0.8rem;">${sub.name}</span>
                    <input type="number" class="subject-grade-input" placeholder="--" style="width:60px; padding:4px; border-radius:4px; border:1px solid #ccc;">
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
    if (confirm("Delete this student record?")) {
        await db.from('students2').delete().eq('id', id);
        loadStudents();
    }
}

function renderSubjectList() {
    const wrapper = $('subject-list');
    wrapper.innerHTML = subjects.map(s => `<div class="subj-pill" style="display:inline-block; padding:4px 12px; background:#f0f0f0; border-radius:15px; margin:2px; font-size:0.8rem;">${s.name}</div>`).join('');
}

function openModal(id) { $(id).classList.add('active'); }
function closeModal(id) { $(id).classList.remove('active'); }

function initChart() {
    const ctx = $('dashboard-chart').getContext('2d');
    dashboardChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'Avg', data: [], backgroundColor: '#800000', borderRadius: 4 }] },
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
    t.style = `position:fixed; bottom:20px; right:20px; padding:10px 20px; border-radius:5px; color:white; background:${type==='success'?'#28a745':'#dc3545'}; z-index:10000; transition:0.5s;`;
    t.innerHTML = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 3000);
}