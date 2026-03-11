const SUPABASE_URL = 'https://bjcqygaqqgknplzjbmiw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqY3F5Z2FxcWdrbnBsempibWl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDQ4NzMsImV4cCI6MjA4ODYyMDg3M30._I5BxEMAK7PtHc87fGhmlPJf31H3j525NqNoUjAgwR8'; 
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentSemesterId = null;
let subjects = [];
let students = [];
let dashboardChart = null;
let studentToDelete = null;

const $ = (id) => document.getElementById(id);

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    loadSemesters();
    initChart();
    bindEvents();
});

function bindEvents() {
    // Mobile Sidebar Toggle
    $('mobile-menu-btn').onclick = () => {
        $('sidebar').classList.add('open');
        $('sidebar-overlay').style.display = 'block';
    };

    const closeSidebar = () => {
        $('sidebar').classList.remove('open');
        $('sidebar-overlay').style.display = 'none';
    };

    $('close-sidebar').onclick = closeSidebar;
    $('sidebar-overlay').onclick = closeSidebar;

    // Semester Change
    $('semester-select').onchange = (e) => {
        currentSemesterId = e.target.value;
        localStorage.setItem('selectedSemesterId', currentSemesterId || '');
        loadDashboard();
        if(window.innerWidth <= 1024) closeSidebar();
    };

    // Modal Triggers
    $('add-semester-btn').onclick = () => openModal('semester-modal');
    $('add-subject-btn').onclick = () => openModal('subject-modal');
    $('add-student-btn').onclick = openAddStudentModal;

    // Save/Action Buttons
    $('save-semester-btn').onclick = addSemester;
    $('save-subject-btn').onclick = addSubject;
    $('save-student-btn').onclick = saveStudent;
    $('update-student-btn').onclick = updateStudent;
    $('confirm-delete-btn').onclick = executeDelete;

    // Search & Filters
    $('search-input').oninput = renderTable;
    $('filter-year').onchange = renderTable;
    $('filter-section').onchange = renderTable;

    // Global Modal Closer
    document.addEventListener('click', (e) => {
        if (e.target.dataset.close) closeModal(e.target.dataset.close);
        if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
    });
}

// --- DATA FETCHING ---

async function loadSemesters() {
    const { data } = await db.from('semesters2').select('*').order('created_at', { ascending: false });
    const select = $('semester-select');
    select.innerHTML = '<option value="">Select Semester</option>';
    data?.forEach(sem => select.innerHTML += `<option value="${sem.id}">${sem.name}</option>`);

    const saved = localStorage.getItem('selectedSemesterId');
    if (saved && data?.find(s => s.id === saved)) {
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
        $('add-student-btn').style.display = 'none';
        return;
    }
    
    $('empty-state').style.display = 'none';
    $('subjects-section').style.display = 'block';

    const { data: subData } = await db.from('subjects2').select('*').eq('semester_id', currentSemesterId);
    subjects = subData || [];
    renderSubjectList();
    
    if (subjects.length > 0) {
        $('table-section').style.display = 'block';
        $('add-student-btn').style.display = 'inline-flex';
        await loadStudents();
    } else {
        $('table-section').style.display = 'none';
        $('add-student-btn').style.display = 'none';
    }
}

async function loadStudents() {
    const { data: studentList } = await db.from('students2').select('*').eq('semester_id', currentSemesterId);
    if (!studentList?.length) {
        students = [];
        renderTable();
        return;
    }

    const { data: gradeData } = await db.from('grades2').select('*').in('student_id', studentList.map(s => s.id));

    students = studentList.map(s => ({
        ...s,
        grades: (gradeData || []).filter(g => g.student_id === s.id)
    }));

    updateFilterOptions();
    renderTable();
}

// --- STUDENT LOGIC ---

function openAddStudentModal() {
    const container = $('grade-inputs');
    container.innerHTML = subjects.map(sub => `
        <div class="input-group" style="margin-bottom:10px;">
            <label style="font-size:0.75rem; color:var(--primary);">${sub.name}</label>
            <input type="number" class="subject-grade-input glass-input-table" data-subject-id="${sub.id}" placeholder="Enter Grade" style="width:100%">
        </div>
    `).join('');
    openModal('student-modal');
}

async function saveStudent() {
    const name = $('new-student-name').value.trim();
    if (!name) return showToast('Name is required', 'danger');

    const { data: student } = await db.from('students2').insert([{ 
        full_name: name, semester_id: currentSemesterId,
        year_level: $('new-student-year').value, section: $('new-student-section').value
    }]).select().single();

    if (student) {
        const inputs = document.querySelectorAll('.subject-grade-input');
        const grades = Array.from(inputs).map(i => ({
            student_id: student.id, subject_id: i.dataset.subjectId,
            score: i.value === '' ? null : parseFloat(i.value)
        })).filter(g => g.score !== null);

        if (grades.length > 0) await db.from('grades2').insert(grades);
        
        closeModal('student-modal');
        showToast('Student Added', 'success');
        loadStudents();
    }
}

function openEditModal(id) {
    const s = students.find(stud => stud.id === id);
    if (!s) return;

    $('edit-student-id').value = s.id;
    $('edit-student-name').value = s.full_name;
    $('edit-student-year').value = s.year_level || '';
    $('edit-student-section').value = s.section || '';

    $('edit-grade-inputs').innerHTML = subjects.map(sub => {
        const grade = s.grades.find(g => g.subject_id === sub.id);
        return `
            <div class="input-group" style="margin-bottom:10px;">
                <label style="font-size:0.75rem; color:var(--primary);">${sub.name}</label>
                <input type="number" class="edit-subject-grade-input glass-input-table" data-subject-id="${sub.id}" value="${grade ? grade.score : ''}" style="width:100%">
            </div>`;
    }).join('');

    studentToDelete = s.id;
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
            student_id: id, subject_id: input.dataset.subjectId, score: score
        }, { onConflict: 'student_id,subject_id' });
    }

    closeModal('edit-modal');
    showToast('Updated', 'success');
    loadStudents();
}

async function executeDelete() {
    await db.from('students2').delete().eq('id', studentToDelete);
    closeModal('confirm-modal');
    closeModal('edit-modal');
    showToast('Deleted', 'success');
    loadStudents();
}

// --- UI RENDERING ---

function renderTable() {
    const searchTerm = $('search-input').value.toLowerCase();
    const year = $('filter-year').value;
    const sec = $('filter-section').value;

    const filtered = students.filter(s => 
        s.full_name.toLowerCase().includes(searchTerm) &&
        (!year || s.year_level === year) &&
        (!sec || s.section === sec)
    );

    $('table-header').innerHTML = '<th>Student Information</th>' + 
        subjects.map(sub => `<th class="text-center">${sub.name}</th>`).join('') + 
        '<th>GWA</th><th></th>';

    $('table-body').innerHTML = filtered.map(s => {
        let sum = 0, count = 0;
        const cells = subjects.map(sub => {
            const g = s.grades.find(g => g.subject_id === sub.id);
            const val = (g && g.score !== null) ? g.score : '-';
            if (val !== '-') { sum += parseFloat(val); count++; }
            return `<td class="text-center">${val}</td>`;
        }).join('');

        const gwa = count > 0 ? (sum / count).toFixed(2) : '0.00';
        return `
            <tr>
                <td><strong>${s.full_name}</strong><br><small>${s.year_level || ''} ${s.section || ''}</small></td>
                ${cells}
                <td class="text-center"><span class="badge ${parseFloat(gwa) >= 75 || (parseFloat(gwa) <= 3.0 && parseFloat(gwa) > 0) ? 'pass' : 'fail'}">${gwa}</span></td>
                <td class="text-center"><button class="btn-icon" onclick="openEditModal('${s.id}')"><i class="fa-solid fa-ellipsis-vertical"></i></button></td>
            </tr>`;
    }).join('');

    updateStats(filtered);
}

function updateStats(data) {
    const total = data.length;
    $('stat-total-students').textContent = total;
    
    let allSum = 0, allCount = 0, passing = 0;
    data.forEach(s => {
        let sSum = 0, sCount = 0;
        s.grades.forEach(g => { if(g.score) { allSum += g.score; allCount++; sSum += g.score; sCount++; } });
        if(sCount > 0 && (sSum/sCount) >= 75) passing++;
    });

    $('stat-average-class').textContent = allCount ? (allSum / allCount).toFixed(1) : '0.0';
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
    if (name) {
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
    $('subject-list').innerHTML = subjects.map(s => `<div class="subj-pill" style="color:white; font-size:0.8rem; margin-bottom:5px;">• ${s.name}</div>`).join('');
}

function openModal(id) { $(id).classList.add('active'); }
function closeModal(id) { $(id).classList.remove('active'); }

function showToast(msg, type) {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = msg;
    $('toast-container').appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

function initChart() {
    const ctx = $('dashboard-chart').getContext('2d');
    dashboardChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'Avg', data: [], backgroundColor: '#800000' }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } } }
    });
}

function updateChart(labels, data) {
    if (!dashboardChart) return;
    dashboardChart.data.labels = labels;
    dashboardChart.data.datasets[0].data = data;
    dashboardChart.update();
}