const SUPABASE_URL = 'https://bjcqygaqqgknplzjbmiw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqY3F5Z2FxcWdrbnBsempibWl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDQ4NzMsImV4cCI6MjA4ODYyMDg3M30._I5BxEMAK7PtHc87fGhmlPJf31H3j525NqNoUjAgwR8'; 
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentSemesterId = null;
let subjects = [];
let students = [];
let dashboardChart = null;
let editingStudentId = null;

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
    
    // Subjects
    $('add-subject-btn').onclick = () => openModal('subject-modal');
    $('save-subject-btn').onclick = addSubject;
    
    // Students
    $('add-student-btn').onclick = openAddStudentModal;
    $('save-student-btn').onclick = saveStudent;

    // Search Feature
    const searchInput = $('search-input');
    if (searchInput) {
        searchInput.oninput = () => renderTable();
    }

    // Universal Cancel Fix
    document.addEventListener('click', (e) => {
        if (e.target.innerText && e.target.innerText.toLowerCase().includes('cancel')) {
            e.preventDefault();
            const modal = e.target.closest('.modal') || document.querySelector('.modal.active');
            if (modal) modal.classList.remove('active');
            editingStudentId = null;
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
    $('table-section').style.display = 'block';
    $('add-student-btn').style.display = 'flex';
    
    if (subjects.length === 0) {
        $('no-subjects-state').style.display = 'flex';
    } else {
        $('no-subjects-state').style.display = 'none';
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

function editStudent(id) {
    const student = students.find(s => s.id === id);
    if (!student) return;

    editingStudentId = id;
    $('new-student-name').value = student.full_name;
    $('new-student-year').value = student.year_level || '';
    $('new-student-section').value = student.section || '';

    openAddStudentModal(); 
    const gradeInputs = document.querySelectorAll('.subject-grade-input');
    subjects.forEach((sub, idx) => {
        const grade = student.grades.find(g => g.subject_id === sub.id);
        if (grade && gradeInputs[idx]) gradeInputs[idx].value = grade.score;
    });
}

async function saveStudent() {
    const name = $('new-student-name').value.trim();
    if (!name) return showToast('Name is required', 'danger');

    let studentId = editingStudentId;

    if (editingStudentId) {
        await db.from('students2').update({
            full_name: name,
            year_level: $('new-student-year').value,
            section: $('new-student-section').value
        }).eq('id', editingStudentId);
    } else {
        const { data, error } = await db.from('students2').insert([{ 
            full_name: name, 
            semester_id: currentSemesterId,
            year_level: $('new-student-year').value,
            section: $('new-student-section').value
        }]).select().single();
        if (error) return showToast('Error saving student', 'danger');
        studentId = data.id;
    }

    const gradeInputs = document.querySelectorAll('.subject-grade-input');
    const gradePromises = [];
    gradeInputs.forEach((input, index) => {
        const val = input.value === '' ? null : parseFloat(input.value);
        gradePromises.push(
            db.from('grades2').upsert({
                student_id: studentId,
                subject_id: subjects[index].id,
                score: val
            }, { onConflict: 'student_id,subject_id' })
        );
    });

    await Promise.all(gradePromises);
    closeModal('student-modal');
    showToast(editingStudentId ? 'Student updated' : 'Student added', 'success');
    editingStudentId = null;
    loadStudents();
}

async function updateGrade(sid, subid, val) {
    const score = val === '' ? null : parseFloat(val);
    await db.from('grades2').upsert({ student_id: sid, subject_id: subid, score: score }, { onConflict: 'student_id,subject_id' });
    loadStudents();
}

function renderTable() {
    const head = $('table-header');
    const body = $('table-body');
    const query = $('search-input')?.value.toLowerCase() || "";
    
    head.innerHTML = '<th>Student Details</th>';
    subjects.forEach(sub => head.innerHTML += `<th class="text-center">${sub.name}</th>`);
    head.innerHTML += '<th class="text-center">GWA</th><th class="text-center">Actions</th>';

    body.innerHTML = '';
    const subjectSums = subjects.map(() => 0);
    const subjectCounts = subjects.map(() => 0);

    const filteredStudents = students.filter(s => s.full_name.toLowerCase().includes(query));

    filteredStudents.forEach(s => {
        let row = `<tr>
            <td>
                <div class="student-info">
                    <span class="student-name" style="font-weight:600;">${s.full_name}</span>
                    <span class="student-meta" style="font-size:0.75rem; color:#666;">${s.year_level || ''}-${s.section || ''}</span>
                </div>
            </td>`;
        
        let total = 0, count = 0;
        subjects.forEach((sub, idx) => {
            const g = s.grades.find(g => g.subject_id === sub.id);
            const val = (g && g.score !== null) ? g.score : '';
            if (val !== '') { total += parseFloat(val); count++; subjectSums[idx] += parseFloat(val); subjectCounts[idx]++; }
            
            row += `<td class="text-center">
                <input type="number" class="table-input" value="${val}" style="width:55px; text-align:center; border:1px solid #ddd; border-radius:4px;" onchange="updateGrade('${s.id}', '${sub.id}', this.value)">
            </td>`;
        });

        const gwa = count > 0 ? (total / count).toFixed(1) : '0.0';
        row += `<td class="text-center"><span class="badge" style="font-weight:bold; color:${gwa >= 75 ? '#2ecc71' : '#e74c3c'}">${gwa}</span></td>`;
        row += `<td class="text-center">
            <button class="btn-icon" onclick="editStudent('${s.id}')" style="background:none; border:none; cursor:pointer; margin-right:5px; color:#3498db;"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon" onclick="deleteStudent('${s.id}')" style="background:none; border:none; cursor:pointer; color:#e74c3c;"><i class="fa-solid fa-trash"></i></button>
        </td></tr>`;
        body.innerHTML += row;
    });

    $('stat-total-students').textContent = students.length;
    updateChart(subjects.map(s => s.name), subjects.map((s, i) => subjectCounts[i] ? (subjectSums[i] / subjectCounts[i]).toFixed(1) : 0));
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
    if (confirm("Permanently delete this student?")) {
        await db.from('grades2').delete().eq('student_id', id);
        await db.from('students2').delete().eq('id', id);
        showToast('Student deleted', 'success');
        loadStudents();
    }
}

function openAddStudentModal() {
    const container = $('grade-inputs');
    if (container) {
        container.innerHTML = `<label style="grid-column: 1/-1; font-weight: 600;">Subject Grades</label>`;
        subjects.forEach(sub => {
            container.innerHTML += `
                <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                    <span style="font-size:0.85rem;">${sub.name}</span>
                    <input type="number" class="subject-grade-input" style="width:60px; padding:3px; border:1px solid #ccc; border-radius:4px;">
                </div>`;
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

function renderSubjectList() {
    const wrapper = $('subject-list');
    wrapper.innerHTML = subjects.map(s => `<div class="subj-pill" style="display:inline-block; padding:3px 10px; background:#eee; border-radius:12px; margin:2px; font-size:0.75rem;">${s.name}</div>`).join('');
}

function openModal(id) { $(id).classList.add('active'); }
function closeModal(id) { $(id).classList.remove('active'); editingStudentId = null; }

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

function showToast(msg, type) {
    const t = document.createElement('div');
    t.style = `position:fixed; bottom:20px; right:20px; padding:10px 20px; border-radius:4px; color:white; background:${type==='success'?'#2ecc71':'#e74c3c'}; z-index:9999;`;
    t.innerHTML = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}