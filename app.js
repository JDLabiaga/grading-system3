const SUPABASE_URL = 'https://bjcqygaqqgknplzjbmiw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqY3F5Z2FxcWdrbnBsempibWl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDQ4NzMsImV4cCI6MjA4ODYyMDg3M30._I5BxEMAK7PtHc87fGhmlPJf31H3j525NqNoUjAgwR8'; 
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentSemesterId = null;
let subjects = [];
let students = [];
let dashboardChart = null;
let studentToDelete = null;

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
    loadSemesters();
    initChart();
    bindEvents();
});

function bindEvents() {
    // Semester Selection
    $('semester-select').onchange = (e) => {
        currentSemesterId = e.target.value;
        localStorage.setItem('selectedSemesterId', currentSemesterId || '');
        loadDashboard();
    };

    // Sidebar & Top Bar Openers
    $('add-semester-btn').onclick = () => openModal('semester-modal');
    $('add-subject-btn').onclick = () => openModal('subject-modal');
    $('add-student-btn').onclick = openAddStudentModal;
    
    // Save Actions
    $('save-semester-btn').onclick = addSemester;
    $('save-subject-btn').onclick = addSubject;
    $('save-student-btn').onclick = saveStudent;
    $('update-student-btn').onclick = updateStudent;
    $('confirm-delete-btn').onclick = executeDelete;

    // Search and Filters
    $('search-input').oninput = renderTable;
    $('filter-year').onchange = renderTable;
    $('filter-section').onchange = renderTable;

    // --- UNIVERSAL MODAL CLOSER ---
    // Handles all [data-close] buttons and clicking outside the modal
    document.addEventListener('click', (e) => {
        if (e.target.dataset.close) {
            closeModal(e.target.dataset.close);
        }
        if (e.target.classList.contains('modal-overlay')) {
            closeModal(e.target.id);
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
        $('subjects-section').style.display = 'none';
        return;
    }
    
    $('empty-state').style.display = 'none';
    $('subjects-section').style.display = 'block';

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
        $('add-student-btn').style.display = 'inline-flex';
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

    updateFilterOptions();
    renderTable();
}

// --- STUDENT ACTIONS ---

function openAddStudentModal() {
    const container = $('grade-inputs');
    container.innerHTML = subjects.map(sub => `
        <div class="grade-input-field">
            <label>${sub.name}</label>
            <input type="number" class="subject-grade-input" data-subject-id="${sub.id}" placeholder="0.0">
        </div>
    `).join('');
    openModal('student-modal');
}

async function saveStudent() {
    const name = $('new-student-name').value.trim();
    if (!name) return showToast('Name is required', 'danger');

    const { data: student, error } = await db.from('students2').insert([{ 
        full_name: name, 
        semester_id: currentSemesterId,
        year_level: $('new-student-year').value,
        section: $('new-student-section').value
    }]).select().single();

    if (student) {
        const gradeInputs = document.querySelectorAll('#grade-inputs .subject-grade-input');
        const grades = Array.from(gradeInputs).map(input => ({
            student_id: student.id,
            subject_id: input.dataset.subjectId,
            score: input.value === '' ? null : parseFloat(input.value)
        })).filter(g => g.score !== null);

        if (grades.length > 0) await db.from('grades2').insert(grades);
        
        closeModal('student-modal');
        showToast('Student added successfully', 'success');
        loadStudents();
    }
}

function openEditModal(id) {
    const s = students.find(stud => stud.id === id);
    $('edit-student-id').value = s.id;
    $('edit-student-name').value = s.full_name;
    $('edit-student-year').value = s.year_level || '';
    $('edit-student-section').value = s.section || '';

    const container = $('edit-grade-inputs');
    container.innerHTML = subjects.map(sub => {
        const grade = s.grades.find(g => g.subject_id === sub.id);
        return `
            <div class="grade-input-field">
                <label>${sub.name}</label>
                <input type="number" class="edit-subject-grade-input" data-subject-id="${sub.id}" value="${grade ? grade.score : ''}">
            </div>
        `;
    }).join('');

    $('delete-student-btn').onclick = () => {
        studentToDelete = s.id;
        openModal('confirm-modal');
    };

    openModal('edit-modal');
}

async function updateStudent() {
    const id = $('edit-student-id').value;
    await db.from('students2').update({
        full_name: $('edit-student-name').value,
        year_level: $('edit-student-year').value,
        section: $('edit-student-section').value
    }).eq('id', id);

    const inputs = document.querySelectorAll('.edit-subject-grade-input');
    for (const input of inputs) {
        const score = input.value === '' ? null : parseFloat(input.value);
        await db.from('grades2').upsert({
            student_id: id,
            subject_id: input.dataset.subjectId,
            score: score
        }, { onConflict: 'student_id,subject_id' });
    }

    closeModal('edit-modal');
    showToast('Student updated', 'success');
    loadStudents();
}

async function executeDelete() {
    if (!studentToDelete) return;
    await db.from('students2').delete().eq('id', studentToDelete);
    closeModal('confirm-modal');
    closeModal('edit-modal');
    showToast('Student deleted', 'success');
    loadStudents();
}

// --- UI RENDERING ---

function renderTable() {
    const searchTerm = $('search-input').value.toLowerCase();
    const yearFilter = $('filter-year').value;
    const secFilter = $('filter-section').value;

    const filtered = students.filter(s => {
        const matchesSearch = s.full_name.toLowerCase().includes(searchTerm);
        const matchesYear = !yearFilter || s.year_level === yearFilter;
        const matchesSec = !secFilter || s.section === secFilter;
        return matchesSearch && matchesYear && matchesSec;
    });

    const head = $('table-header');
    head.innerHTML = '<th>Student Information</th>';
    subjects.forEach(sub => head.innerHTML += `<th class="text-center">${sub.name}</th>`);
    head.innerHTML += '<th>GWA</th><th></th>';

    const body = $('table-body');
    body.innerHTML = filtered.map(s => {
        let total = 0, count = 0;
        const gradeCells = subjects.map(sub => {
            const g = s.grades.find(g => g.subject_id === sub.id);
            const val = (g && g.score !== null) ? g.score : '-';
            if (val !== '-') { total += val; count++; }
            return `<td class="text-center">${val}</td>`;
        }).join('');

        const gwa = count > 0 ? (total / count).toFixed(2) : '0.00';
        return `
            <tr>
                <td>
                    <div class="student-info">
                        <strong>${s.full_name}</strong>
                        <small>${s.year_level || ''} ${s.section || ''}</small>
                    </div>
                </td>
                ${gradeCells}
                <td><span class="badge ${gwa >= 75 || gwa <= 3.0 ? 'pass' : 'fail'}">${gwa}</span></td>
                <td><button class="btn-icon" onclick="openEditModal('${s.id}')"><i class="fa-solid fa-ellipsis-vertical"></i></button></td>
            </tr>
        `;
    }).join('');

    updateStats(filtered);
}

function updateStats(data) {
    const total = data.length;
    $('stat-total-students').textContent = total;
    
    let allGrades = 0, gradeCount = 0, passing = 0;
    data.forEach(s => {
        let sTotal = 0, sCount = 0;
        s.grades.forEach(g => { 
            if(g.score) { allGrades += g.score; gradeCount++; sTotal += g.score; sCount++; } 
        });
        if(sCount > 0 && (sTotal/sCount) >= 75) passing++;
    });

    $('stat-average-class').textContent = gradeCount ? (allGrades / gradeCount).toFixed(1) : '0.0';
    $('stat-pass-rate').textContent = total ? Math.round((passing / total) * 100) + '%' : '0%';
    
    updateChart(subjects.map(s => s.name), subjects.map(sub => {
        const subGrades = data.flatMap(s => s.grades).filter(g => g.subject_id === sub.id && g.score);
        return subGrades.length ? (subGrades.reduce((a,b) => a + b.score, 0) / subGrades.length).toFixed(1) : 0;
    }));
}

// --- UTILS ---

async function addSemester() {
    const name = $('semester-name').value.trim();
    if (name) {
        await db.from('semesters2').insert([{ name }]);
        $('semester-name').value = '';
        closeModal('semester-modal');
        loadSemesters();
    }
}

async function addSubject() {
    const name = $('new-subject-name').value.trim();
    if (name && currentSemesterId) {
        await db.from('subjects2').insert([{ name, semester_id: currentSemesterId }]);
        $('new-subject-name').value = '';
        closeModal('subject-modal');
        loadDashboard();
    }
}

function updateFilterOptions() {
    const years = [...new Set(students.map(s => s.year_level))].filter(Boolean);
    const sections = [...new Set(students.map(s => s.section))].filter(Boolean);
    
    $('filter-year').innerHTML = '<option value="">Year Level</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
    $('filter-section').innerHTML = '<option value="">Section</option>' + sections.map(s => `<option value="${s}">${s}</option>`).join('');
}

function renderSubjectList() {
    $('subject-list').innerHTML = subjects.map(s => `<div class="subj-pill">${s.name}</div>`).join('');
}

function openModal(id) { $(id).classList.add('active'); }
function closeModal(id) { $(id).classList.remove('active'); }

function showToast(msg, type) {
    const t = document.createElement('div');
    t.className = `toast-notif ${type}`;
    t.innerHTML = msg;
    $('toast-container').appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

function initChart() {
    const ctx = $('dashboard-chart').getContext('2d');
    dashboardChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'Avg', data: [], backgroundColor: '#800000' }] },
        options: { responsive: true, scales: { y: { beginAtZero: true, max: 100 } } }
    });
}

function updateChart(labels, data) {
    if (!dashboardChart) return;
    dashboardChart.data.labels = labels;
    dashboardChart.data.datasets[0].data = data;
    dashboardChart.update();
}