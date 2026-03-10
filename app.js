// ===== Supabase Config =====
const SUPABASE_URL = 'https://bjcqygaqqgknplzjbmiw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqY3F5Z2FxcWdrbnBsempibWl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDQ4NzMsImV4cCI6MjA4ODYyMDg3M30._I5BxEMAK7PtHc87fGhmlPJf31H3j525NqNoUjAgwR8';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== State =====
let currentUser = { id: '00000000-0000-0000-0000-000000000000', email: 'admin@system.com' }; // Mock user since login is removed
let currentSemesterId = null;
let semesters = [];
let subjects = [];
let students = [];
let sortColumn = null;
let sortDirection = 'asc';
let pendingDeleteFn = null;
let filterYearLevel = '';
let filterSection = '';

// ===== DOM References =====
const $ = (id) => document.getElementById(id);

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    bindEvents();
});

async function initApp() {
    // Directly show dashboard and load data
    $('dashboard-section').style.display = 'flex';
    $('user-email').textContent = currentUser.email;
    await loadSemesters();
}

function bindEvents() {
    // Sidebar
    if ($('sidebar-collapse-btn')) $('sidebar-collapse-btn').addEventListener('click', toggleSidebar);
    $('sidebar-open-btn').addEventListener('click', toggleSidebar);
    $('sidebar-overlay').addEventListener('click', closeSidebar);

    // Subjects toggle (collapsible)
    $('subjects-toggle').addEventListener('click', toggleSubjectsMenu);

    // Semester
    $('semester-select').addEventListener('change', switchSemester);
    $('add-semester-btn').addEventListener('click', () => openModal('semester-modal'));
    $('save-semester-btn').addEventListener('click', addSemester);

    // Subject
    $('add-subject-btn').addEventListener('click', () => openModal('subject-modal'));
    $('save-subject-btn').addEventListener('click', addSubject);

    // Student
    $('add-student-btn').addEventListener('click', () => openAddStudentModal());
    $('save-student-btn').addEventListener('click', saveStudent);
    $('update-student-btn').addEventListener('click', updateStudent);
    $('delete-student-btn').addEventListener('click', () => {
        const studentId = $('edit-student-id').value;
        const studentName = $('edit-student-name').value;
        closeModal('edit-modal');
        confirmDelete(`Delete student "${studentName}"?`, () => deleteStudent(studentId));
    });

    // Confirm modal
    $('confirm-delete-btn').addEventListener('click', () => {
        if (pendingDeleteFn) pendingDeleteFn();
        closeModal('confirm-modal');
        pendingDeleteFn = null;
    });

    // Search
    $('search-input').addEventListener('input', filterTable);

    // Filters
    $('filter-year').addEventListener('change', (e) => {
        filterYearLevel = e.target.value;
        renderTableBody();
    });
    $('filter-section').addEventListener('change', (e) => {
        filterSection = e.target.value;
        renderTableBody();
    });

    // Modal close buttons
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });

    // Close modal on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    // Escape key closes modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-overlay.active').forEach(m => closeModal(m.id));
        }
    });
}

// ===== Sidebar Actions =====
function toggleSidebar() {
    const sidebar = $('sidebar');
    const isMobile = window.innerWidth <= 1024;

    if (isMobile) {
        sidebar.classList.toggle('open');
        $('sidebar-overlay').classList.toggle('active', sidebar.classList.contains('open'));
    } else {
        sidebar.classList.toggle('collapsed');
    }
}

function closeSidebar() {
    $('sidebar').classList.remove('open');
    $('sidebar-overlay').classList.remove('active');
}

function toggleSubjectsMenu() {
    const toggle = $('subjects-toggle');
    const wrapper = $('subject-list-wrapper');
    toggle.classList.toggle('collapsed');
    wrapper.classList.toggle('collapsed');
}

// ===== Toast Notifications =====
function toast(message, type = 'success') {
    const container = $('toast-container');
    const icons = {
        success: 'fa-circle-check',
        error: 'fa-circle-xmark',
        warning: 'fa-triangle-exclamation'
    };

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
        <i class="fa-solid ${icons[type] || icons.success}"></i>
        <span>${escapeHtml(message)}</span>
        <button class="toast-close">&times;</button>
    `;

    el.querySelector('.toast-close').addEventListener('click', () => removeToast(el));
    container.appendChild(el);
    setTimeout(() => removeToast(el), 4000);
}

function removeToast(el) {
    if (!el.parentNode) return;
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove());
}

// ===== Modals =====
function openModal(id) {
    $(id).classList.add('active');
    const firstInput = $(id).querySelector('input:not([type=hidden])');
    if (firstInput) setTimeout(() => firstInput.focus(), 100);
}

function closeModal(id) {
    $(id).classList.remove('active');
}

function confirmDelete(message, onConfirm) {
    $('confirm-message').textContent = message;
    pendingDeleteFn = onConfirm;
    openModal('confirm-modal');
}

// ===== Semesters =====
async function loadSemesters() {
    const { data, error } = await db.from('semesters')
        .select('*')
        .order('id', { ascending: false });
    
    if (error) {
        toast('Failed to load semesters', 'error');
        return;
    }
    semesters = data || [];
    renderSemesterOptions();
}

function renderSemesterOptions() {
    const select = $('semester-select');
    select.innerHTML = '<option value="">-- Select --</option>';
    semesters.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        if (s.id === currentSemesterId) opt.selected = true;
        select.appendChild(opt);
    });
}

async function addSemester() {
    const name = $('semester-name').value.trim();
    if (!name) { toast('Enter a semester name', 'warning'); return; }

    const { data, error } = await db.from('semesters')
        .insert([{ name, teacher_id: currentUser.id }])
        .select().single();
    if (error) { toast('Failed to create semester', 'error'); return; }

    semesters.unshift(data);
    renderSemesterOptions();
    $('semester-select').value = data.id;
    $('semester-name').value = '';
    closeModal('semester-modal');
    toast(`Semester "${name}" created`, 'success');
    await switchSemester();
}

async function switchSemester() {
    const id = $('semester-select').value;
    if (!id) {
        currentSemesterId = null;
        subjects = [];
        students = [];
        $('page-title').textContent = 'Overview';
        $('add-student-btn').style.display = 'none';
        $('subjects-section').style.display = 'none';
        $('table-section').style.display = 'none';
        $('no-subjects-state').style.display = 'none';
        $('empty-state').style.display = 'flex';
        return;
    }

    currentSemesterId = parseInt(id);
    const sem = semesters.find(s => s.id === currentSemesterId);
    $('page-title').textContent = sem ? sem.name : 'Dashboard';
    $('empty-state').style.display = 'none';
    $('subjects-section').style.display = 'block';

    await loadSubjects();
    await loadStudents();
}

// ===== Subjects =====
async function loadSubjects() {
    const { data, error } = await db.from('subjects')
        .select('*')
        .eq('semester_id', currentSemesterId)
        .order('id');

    if (error) { toast('Failed to load subjects', 'error'); return; }
    subjects = data || [];
    renderSubjectList();
    updateTableVisibility();
}

function renderSubjectList() {
    const list = $('subject-list');
    list.innerHTML = '';

    subjects.forEach(sub => {
        const item = document.createElement('div');
        item.className = 'subject-item';
        item.innerHTML = `
            <div class="subject-name">
                <i class="fa-solid fa-book-open"></i>
                <span>${escapeHtml(sub.name)}</span>
            </div>
            <button class="delete-subject" title="Delete subject">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;
        item.querySelector('.delete-subject').addEventListener('click', (e) => {
            e.stopPropagation();
            confirmDelete(`Delete subject "${sub.name}"? All related grades will be removed.`, () => deleteSubject(sub.id));
        });
        list.appendChild(item);
    });
}

async function addSubject() {
    const name = $('new-subject-name').value.trim();
    if (!name) { toast('Enter a subject name', 'warning'); return; }
    if (!currentSemesterId) { toast('Select a semester first', 'warning'); return; }

    const { data, error } = await db.from('subjects')
        .insert([{ name, semester_id: currentSemesterId }])
        .select().single();

    if (error) { toast('Failed to add subject', 'error'); return; }

    subjects.push(data);
    renderSubjectList();
    $('new-subject-name').value = '';
    closeModal('subject-modal');
    toast(`Subject "${name}" added`, 'success');
    await loadStudents();
}

async function deleteSubject(id) {
    await db.from('grades').delete().eq('subject_id', id);
    const { error } = await db.from('subjects').delete().eq('id', id);
    if (error) { toast('Failed to delete subject', 'error'); return; }

    subjects = subjects.filter(s => s.id !== id);
    renderSubjectList();
    toast('Subject deleted', 'success');
    await loadStudents();
}

// ===== Students & Table Logic =====
async function loadStudents() {
    if (!currentSemesterId) return;

    const { data: studentData, error: studentError } = await db.from('students')
        .select('id, full_name, year_level, section')
        .eq('semester_id', currentSemesterId)
        .order('full_name');

    if (studentError) { toast('Failed to load students', 'error'); return; }

    const studentList = studentData || [];

    if (studentList.length === 0) {
        students = [];
        updateFilterOptions();
        renderTable();
        return;
    }

    const studentIds = studentList.map(s => s.id);
    const { data: gradeData, error: gradeError } = await db.from('grades')
        .select('id, student_id, subject_id, score')
        .in('student_id', studentIds);

    if (gradeError) { toast('Failed to load grades', 'error'); }

    const gradesByStudent = {};
    (gradeData || []).forEach(g => {
        if (!gradesByStudent[g.student_id]) gradesByStudent[g.student_id] = [];
        gradesByStudent[g.student_id].push(g);
    });

    students = studentList.map(s => ({
        ...s,
        grades: gradesByStudent[s.id] || []
    }));

    updateFilterOptions();
    renderTable();
}

function updateFilterOptions() {
    const yearSet = new Set();
    const sectionSet = new Set();
    students.forEach(s => {
        if (s.year_level) yearSet.add(s.year_level);
        if (s.section) sectionSet.add(s.section);
    });

    const yearSelect = $('filter-year');
    yearSelect.innerHTML = '<option value="">Year Level</option>';
    [...yearSet].sort().forEach(y => {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = y;
        yearSelect.appendChild(opt);
    });

    const sectionSelect = $('filter-section');
    sectionSelect.innerHTML = '<option value="">Section</option>';
    [...sectionSet].sort().forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        sectionSelect.appendChild(opt);
    });
}

function updateTableVisibility() {
    if (subjects.length === 0 && currentSemesterId) {
        $('table-section').style.display = 'none';
        $('no-subjects-state').style.display = 'flex';
        $('add-student-btn').style.display = 'none';
    } else if (currentSemesterId) {
        $('no-subjects-state').style.display = 'none';
        $('table-section').style.display = 'block';
        $('add-student-btn').style.display = 'inline-flex';
    }
}

function renderTable() {
    updateTableVisibility();
    renderTableHeader();
    renderTableBody();
}

function renderTableHeader() {
    const header = $('table-header');
    header.innerHTML = '';

    const cols = [
        { label: 'Name', key: 'name' },
        { label: 'Year', key: 'year_level' },
        { label: 'Section', key: 'section' }
    ];

    cols.forEach(c => header.appendChild(createTh(c.label, c.key)));
    subjects.forEach(sub => header.appendChild(createTh(sub.name, `subject_${sub.id}`)));
    header.appendChild(createTh('Avg', 'avg'));

    const thActions = document.createElement('th');
    thActions.textContent = 'Actions';
    header.appendChild(thActions);
}

function createTh(label, key) {
    const th = document.createElement('th');
    th.innerHTML = `${escapeHtml(label)} <i class="fa-solid fa-sort sort-icon"></i>`;
    th.addEventListener('click', () => handleSort(key));
    return th;
}

function handleSort(key) {
    if (sortColumn === key) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = key;
        sortDirection = 'asc';
    }
    renderTableBody();
}

function renderTableBody() {
    const tbody = $('table-body');
    tbody.innerHTML = '';

    const searchFilter = $('search-input').value.toLowerCase().trim();
    const filtered = students.filter(s => {
        if (searchFilter && !s.full_name.toLowerCase().includes(searchFilter)) return false;
        if (filterYearLevel && s.year_level !== filterYearLevel) return false;
        if (filterSection && s.section !== filterSection) return false;
        return true;
    });

    filtered.forEach(student => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="student-name-cell">${escapeHtml(student.full_name)}</td>
            <td>${student.year_level || '—'}</td>
            <td>${student.section || '—'}</td>
        `;

        subjects.forEach(sub => {
            const td = document.createElement('td');
            const score = getGradeScore(student, sub.id);
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'glass-input-table';
            input.value = score;
            input.dataset.original = score;
            input.addEventListener('change', () => handleInlineGradeEdit(input, student, sub.id));
            td.appendChild(input);
            tr.appendChild(td);
        });

        const avg = computeAverage(student);
        const tdAvg = document.createElement('td');
        tdAvg.className = `avg-cell ${avg >= 75 ? 'avg-pass' : 'avg-fail'}`;
        tdAvg.textContent = avg.toFixed(1);
        tr.appendChild(tdAvg);

        const tdActions = document.createElement('td');
        tdActions.className = 'action-btns';
        tdActions.innerHTML = `
            <button class="btn-table edit"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-table delete"><i class="fa-solid fa-trash"></i></button>
        `;
        tdActions.querySelector('.edit').onclick = () => openEditStudentModal(student);
        tdActions.querySelector('.delete').onclick = () => confirmDelete(`Delete ${student.full_name}?`, () => deleteStudent(student.id));
        
        tr.appendChild(tdActions);
        tbody.appendChild(tr);
    });
}

// ===== Logic Functions (Simplified) =====
async function handleInlineGradeEdit(input, student, subjectId) {
    const newScore = parseFloat(input.value);
    if (isNaN(newScore) || newScore < 0 || newScore > 100) {
        input.value = input.dataset.original;
        toast('Invalid Grade', 'warning');
        return;
    }

    const existingGrade = student.grades.find(g => g.subject_id === subjectId);
    let error;

    if (existingGrade) {
        ({ error } = await db.from('grades').update({ score: newScore }).eq('id', existingGrade.id));
        if (!error) existingGrade.score = newScore;
    } else {
        const { data, error: insertError } = await db.from('grades')
            .insert([{ student_id: student.id, subject_id: subjectId, score: newScore }])
            .select().single();
        error = insertError;
        if (!error) student.grades.push(data);
    }

    if (error) toast('Update Failed', 'error');
    else renderTableBody();
}

function openAddStudentModal() {
    $('new-student-name').value = '';
    const container = $('grade-inputs');
    container.innerHTML = '';
    subjects.forEach(sub => {
        container.innerHTML += `
            <div class="grade-input-row">
                <label>${escapeHtml(sub.name)}</label>
                <input type="number" data-subject-id="${sub.id}" value="0">
            </div>`;
    });
    openModal('student-modal');
}

async function saveStudent() {
    const name = $('new-student-name').value.trim();
    if (!name) return;

    const { data: student, error } = await db.from('students')
        .insert([{ 
            full_name: name, 
            semester_id: currentSemesterId, 
            year_level: $('new-student-year').value, 
            section: $('new-student-section').value 
        }])
        .select().single();

    if (error) { toast('Error adding student', 'error'); return; }

    const gradeInputs = $('grade-inputs').querySelectorAll('input');
    const grades = Array.from(gradeInputs).map(inp => ({
        student_id: student.id,
        subject_id: parseInt(inp.dataset.subjectId),
        score: parseFloat(inp.value) || 0
    }));

    await db.from('grades').insert(grades);
    closeModal('student-modal');
    await loadStudents();
    toast('Student Added', 'success');
}

// Helper Functions
function getGradeScore(student, subjectId) {
    const grade = student.grades.find(g => g.subject_id === subjectId);
    return grade ? grade.score : 0;
}

function computeAverage(student) {
    if (subjects.length === 0) return 0;
    const total = subjects.reduce((sum, sub) => sum + getGradeScore(student, sub.id), 0);
    return total / subjects.length;
}

function filterTable() { renderTableBody(); }

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

async function deleteStudent(id) {
    await db.from('grades').delete().eq('student_id', id);
    await db.from('students').delete().eq('id', id);
    students = students.filter(s => s.id !== id);
    renderTableBody();
    toast('Student Deleted', 'success');
}

async function updateStudent() {
    const id = parseInt($('edit-student-id').value);
    const name = $('edit-student-name').value.trim();
    
    await db.from('students').update({ 
        full_name: name,
        year_level: $('edit-student-year').value,
        section: $('edit-student-section').value
    }).eq('id', id);

    closeModal('edit-modal');
    await loadStudents();
    toast('Updated', 'success');
}

function openEditStudentModal(student) {
    $('edit-student-id').value = student.id;
    $('edit-student-name').value = student.full_name;
    $('edit-student-year').value = student.year_level || '';
    $('edit-student-section').value = student.section || '';
    
    const container = $('edit-grade-inputs');
    container.innerHTML = '';
    subjects.forEach(sub => {
        container.innerHTML += `
            <div class="grade-input-row">
                <label>${escapeHtml(sub.name)}</label>
                <input type="number" data-subject-id="${sub.id}" value="${getGradeScore(student, sub.id)}">
            </div>`;
    });
    openModal('edit-modal');
}