const SUPABASE_URL = 'https://bjcqygaqqgknplzjbmiw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqY3F5Z2FxcWdrbnBsempibWl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDQ4NzMsImV4cCI6MjA4ODYyMDg3M30._I5BxEMAK7PtHc87fGhmlPJf31H3j525NqNoUjAgwR8'; // Use your full key
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = { id: '00000000-0000-0000-0000-000000000000' };
let currentSemesterId = null;
let subjects = [];
let students = [];
let dashboardChart = null;
let selectedSubjectId = null;

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
        try { localStorage.setItem('selectedSemesterId', currentSemesterId || ''); } catch(e) { }
        loadDashboard();
    };

    $('add-semester-btn').onclick = () => openModal('semester-modal');
    $('save-semester-btn').onclick = addSemester;
    $('add-subject-btn').onclick = () => openModal('subject-modal');
    $('save-subject-btn').onclick = addSubject;
    const addSubjectTop = $('add-subject-top-btn'); if (addSubjectTop) addSubjectTop.onclick = () => openModal('subject-modal');
    // Search & filters
    const search = $('search-input'); if (search) search.oninput = () => renderTable();
    const fy = $('filter-year'); if (fy) fy.onchange = () => renderTable();
    const fs = $('filter-section'); if (fs) fs.onchange = () => renderTable();
    $('add-student-btn').onclick = openAddStudentModal;
    $('save-student-btn').onclick = saveStudent;
}

async function loadSemesters() {
    try {
        const { data, error, status } = await db.from('semesters2').select('*').order('created_at', { ascending: false });
        if (error) {
            console.error('loadSemesters error', error, status);
            // If error indicates missing API key or 401, try REST fallback
            if (status === 401 || (error && /No API key/i.test(error.message || ''))) {
                const fallback = await restFetch('/semesters2?select=*');
                if (fallback.ok) {
                    const json = await fallback.json();
                    renderSemestersToSelect(json);
                    return;
                }
            }
            showToast('Failed to load semesters: ' + (error.message || status), 'danger');
            return;
        }
        renderSemestersToSelect(data);
    } catch (err) {
        console.error('loadSemesters unexpected', err);
        showToast('Unexpected error loading semesters', 'danger');
    }
}

function renderSemestersToSelect(data) {
    const select = $('semester-select');
    if (!select) return;
    select.innerHTML = '<option value="">Select Semester</option>';
    data?.forEach(sem => {
        select.innerHTML += `<option value="${sem.id}">${sem.name}</option>`;
    });
    // Restore previously-selected semester from localStorage if present
    try {
        const saved = localStorage.getItem('selectedSemesterId');
        if (saved) {
            const opt = Array.from(select.options).find(o => o.value === saved);
            if (opt) {
                select.value = saved;
                currentSemesterId = saved;
                // load dashboard for the restored semester
                setTimeout(()=>loadDashboard(), 0);
                return;
            }
        }
    } catch (e) { /* ignore */ }
}

// Lightweight REST fallback using the anon key when supabase-js fails to attach headers
function restFetch(path, method = 'GET', body = null) {
    const url = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1' + path;
    const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY
    };
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
    // always show subjects area when a semester is selected
    const subjSection = $('subjects-section'); if (subjSection) subjSection.style.display = currentSemesterId ? 'block' : 'none';
    renderSubjectList();
    // show add subject controls
    const addSubBtn = $('add-subject-btn'); if (addSubBtn) addSubBtn.style.display = currentSemesterId ? 'flex' : 'none';
    const addTop = $('add-subject-top-btn'); if (addTop) addTop.style.display = currentSemesterId ? 'inline-flex' : 'none';
    
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
    const { data: studentList = [], error: studentErr } = await db.from('students2').select('*').eq('semester_id', currentSemesterId);
    if (studentErr) {
        console.error('loadStudents: failed to load students', studentErr);
        students = [];
        renderTable();
        return;
    }

    let gradeData = [];
    try {
        if (studentList.length > 0) {
            const ids = studentList.map(s => s.id);
            const res = await db.from('grades2').select('*').in('student_id', ids);
            gradeData = res.data || [];
        }
    } catch (e) {
        console.warn('loadStudents: failed to load grades', e);
        gradeData = [];
    }

    students = (studentList || []).map(s => ({
        ...s,
        grades: (gradeData || []).filter(g => String(g.student_id) === String(s.id))
    }));
    populateFilterOptions();
    renderTable();
    // Update dashboard chart & stats
    // Update filters and render table (renderTable handles table/chart rendering)
    populateFilterOptions();
    renderTable();

    function populateFilterOptions() {
        const years = Array.from(new Set(students.map(s => s.year_level))).filter(Boolean).sort();
        const sections = Array.from(new Set(students.map(s => s.section))).filter(Boolean).sort();
        const fy = $('filter-year'); const fs = $('filter-section');
        if (fy) {
            fy.innerHTML = '<option value="">Year Level</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
        }
        if (fs) {
            fs.innerHTML = '<option value="">Section</option>' + sections.map(s => `<option value="${s}">${s}</option>`).join('');
        }
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
    // Prepare subject averages
    const subjectSums = subjects.map(() => 0);
    const subjectCounts = subjects.map(() => 0);

    const visibleStudents = students; // no additional filters here; keep existing filter UI if needed

    visibleStudents.forEach(s => {
        let row = `<tr><td>${s.full_name}</td><td>${s.year_level || ''}-${s.section || ''}</td>`;
        let total = 0;
        subjects.forEach((sub, idx) => {
            const g = (s.grades || []).find(g => String(g.subject_id) === String(sub.id));
            const gradeVal = g && g.score != null ? parseFloat(g.score) : NaN;
            const display = !isNaN(gradeVal) ? gradeVal : '';
            if (!isNaN(gradeVal)) {
                total += gradeVal;
                subjectSums[idx] += gradeVal;
                subjectCounts[idx] += 1;
            }
            row += `<td><input type="number" step="0.1" class="glass-input-table" value="${display}" onchange="updateGrade('${s.id}', '${sub.id}', this.value)"></td>`;
        });
        const avg = subjects.length ? (total / subjects.length) : 0;
        const avgDisplay = (Math.round(avg * 10) / 10).toFixed(1);
        row += `<td style="font-weight:bold; color:${avg >= 75 ? 'green':'red'}">${avgDisplay}</td>`;
        row += `<td><button class="btn btn-sm btn-outline" onclick="deleteStudent('${s.id}')"><i class="fa-solid fa-trash"></i></button></td></tr>`;
        body.innerHTML += row;
    });

    // Update class stats
    const totalStudents = students.length;
    const classAvg = totalStudents ? (students.reduce((acc, st) => {
        // compute each student's average
        let stTotal = 0; let stCount = 0;
        subjects.forEach(sub => {
            const g = (st.grades || []).find(x => String(x.subject_id) === String(sub.id));
            const v = g && g.score != null ? parseFloat(g.score) : NaN;
            if (!isNaN(v)) { stTotal += v; stCount++; }
        });
        return acc + (stCount ? stTotal / subjects.length : 0);
    }, 0) / totalStudents) : 0;
    const classAvgDisplay = (Math.round(classAvg * 10) / 10).toFixed(1);
    const passCount = students.filter(st => {
        // student average
        let stTotal = 0; let stCount = 0;
        subjects.forEach(sub => {
            const g = (st.grades || []).find(x => String(x.subject_id) === String(sub.id));
            const v = g && g.score != null ? parseFloat(g.score) : NaN;
            if (!isNaN(v)) { stTotal += v; stCount++; }
        });
        const stAvg = stCount ? stTotal / subjects.length : 0;
        return stAvg >= 75;
    }).length;
    const passRate = totalStudents ? Math.round((passCount / totalStudents) * 100) : 0;

    document.getElementById('stat-total-students').textContent = totalStudents;
    document.getElementById('stat-average-class').textContent = classAvgDisplay;
    document.getElementById('stat-pass-rate').textContent = passRate + '%';

    // Update chart with subject averages
    const labels = subjects.map(s => s.name);
    const averages = subjects.map((s, i) => subjectCounts[i] ? Math.round((subjectSums[i] / subjectCounts[i]) * 10) / 10 : 0);
    updateChart(labels, averages);
}

// Helper: Modals
function closeModal(id) { const el = $(id); if (el) el.classList.remove('active'); }

// Open modal and autofocus the first input inside it. Clicking the overlay closes only when clicking the overlay itself.
function openModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add('active');

    // Attach safe overlay click handler (only once)
    if (!el._overlayHandlerAttached) {
        el.addEventListener('click', (e) => {
            if (e.target === el) closeModal(el.dataset.close);
        });
        el._overlayHandlerAttached = true;
    }

    // autofocus first input inside the modal
    try {
        const modal = el.querySelector('.modal');
        if (modal) {
            const input = modal.querySelector('input, textarea, select');
            if (input) input.focus();
        }
    } catch (e) { /* ignore */ }
}

// Wire up close buttons (elements with data-close attribute other than overlays)
document.querySelectorAll('[data-close]').forEach(el => {
    if (!el.classList.contains('modal-overlay')) {
        el.addEventListener('click', () => closeModal(el.dataset.close));
    }
});

async function addSemester() {
    const btn = $('save-semester-btn');
    const name = $('semester-name').value?.trim();
    if (!name) { showToast('Please enter a semester name','danger'); return; }
    btn.disabled = true;
    try {
        // Ensure we provide a teacher_id if the table requires it (avoid NOT NULL violations)
        let teacher_id = currentUser?.id;
        // If currentUser is missing or is placeholder, try to obtain a fallback teacher_id from existing semesters
        const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';
        if (!teacher_id || teacher_id === PLACEHOLDER_ID) {
            try {
                const { data: oneSem, error: oneErr } = await db.from('semesters').select('teacher_id').limit(1).single();
                if (!oneErr && oneSem && oneSem.teacher_id) teacher_id = oneSem.teacher_id;
            } catch (ee) { /* ignore */ }
        }

        const payload = teacher_id ? { name, teacher_id } : { name };
        const { data, error } = await db.from('semesters2').insert([payload]).select().single();
        if (error) throw error;
        showToast('Semester created', 'success');
        closeModal('semester-modal');
        // reload semesters and select new
        await loadSemesters();
        if (data && data.id) {
            currentSemesterId = data.id;
            const sel = $('semester-select');
            if (sel) sel.value = data.id;
            try { localStorage.setItem('selectedSemesterId', data.id); } catch(e) { }
            await loadDashboard();
        }
    } catch (err) {
        console.error('addSemester error', err);
        console.error('addSemester error', err);
        // If the error indicates missing API key / 401, attempt REST fallback
        if (err && (err.status === 401 || /No API key/i.test(err.message || ''))) {
            try {
                const fallbackPayload = teacher_id ? { name, teacher_id } : { name };
                    const res = await restFetch('/semesters2', 'POST', fallbackPayload);
                if (res.ok) {
                    const created = await res.json();
                    showToast('Semester created (fallback)', 'success');
                    closeModal('semester-modal');
                    await loadSemesters();
                    if (created && created[0] && created[0].id) {
                        currentSemesterId = created[0].id;
                        const sel = $('semester-select'); if (sel) sel.value = created[0].id;
                        try { localStorage.setItem('selectedSemesterId', created[0].id); } catch(e) { }
                        await loadDashboard();
                    }
                    btn.disabled = false;
                    return;
                } else {
                    const txt = await res.text();
                    console.error('rest fallback failed', res.status, txt);
                }
            } catch (re) { console.error('rest fallback error', re); }
        }
        showToast('Failed to create semester', 'danger');
    } finally {
        btn.disabled = false;
    }
}

// Toast helper
function showToast(message, type = 'info', timeout = 3500) {
    const container = $('toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.borderLeftColor = type === 'danger' ? 'var(--danger)' : type === 'success' ? 'var(--success)' : 'var(--primary)';
    t.textContent = message;
    container.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.addEventListener('transitionend', () => t.remove()); }, timeout);
}

async function addSubject() {
    const name = $('new-subject-name').value;
    await db.from('subjects2').insert([{ name, semester_id: currentSemesterId }]);
    loadDashboard();
    closeModal('subject-modal');
}

async function saveStudent() {
    const name = $('new-student-name').value?.trim();
    const year = $('new-student-year').value?.trim();
    const section = $('new-student-section').value?.trim();

    if (!currentSemesterId) { showToast('Please select a semester first','danger'); return; }
    if (!subjects || subjects.length === 0) { showToast('Add at least one subject before adding students','danger'); return; }
    if (!name) { showToast('Please enter the student full name','danger'); return; }

    try {
        const { data } = await db.from('students2').insert([{ 
            full_name: name, 
            semester_id: currentSemesterId,
            year_level: year,
            section: section
        }]).select().single();

        // Add default grades
        const grades = subjects.map(sub => ({ student_id: data.id, subject_id: sub.id, score: null }));
        await db.from('grades2').insert(grades);

        closeModal('student-modal');
        showToast('Student added', 'success');
        loadStudents();
    } catch (err) {
        console.error('saveStudent error', err);
        showToast('Failed to add student','danger');
    }
}

async function updateGrade(sid, subid, val) {
    const score = val === '' ? null : parseFloat(val);
    try {
        // Upsert so a grade row is created if it doesn't exist yet
        const res = await db.from('grades2').upsert([{ student_id: sid, subject_id: subid, score }], { onConflict: ['student_id', 'subject_id'] }).select();
        if (res.error) {
            console.error('updateGrade upsert error', res.error);
            showToast('Failed to save grade', 'danger');
            return;
        }
    } catch (e) {
        // Fallback to update if upsert not allowed
        try { await db.from('grades2').update({ score }).match({ student_id: sid, subject_id: subid }); } catch (ee) { console.error('updateGrade failed', ee); }
    }
    await loadStudents(); // Refresh average
}

async function deleteStudent(id) {
    if(confirm("Delete student?")) {
        await db.from('students2').delete().eq('id', id);
        loadStudents();
    }
}

function openAddStudentModal() {
    $('grade-inputs').innerHTML = '';
    subjects.forEach(sub => {
        $('grade-inputs').innerHTML += `<div class="input-group"><span>${sub.name}</span><input type="number" value="0"></div>`;
    });
    openModal('student-modal');
    // autofocus name input
    setTimeout(()=>{ const input = document.getElementById('new-student-name'); if(input) input.focus(); }, 100);
}

function renderSubjectList() {
    const wrapper = $('subject-list');
    const section = document.getElementById('subjects-section');
    if (!wrapper) return;
    // show the section even if there are no subjects (so user can add one)
    if (section) section.style.display = currentSemesterId ? 'block' : 'none';
    if (!subjects || subjects.length === 0) {
        wrapper.innerHTML = '<div class="subject-empty">No subjects yet. Click Add Subject.</div>';
        return;
    }
    wrapper.innerHTML = '';
    // Restore selected subject from localStorage if present
    try {
        const savedSub = localStorage.getItem('selectedSubjectId');
        if (savedSub) {
            const found = subjects.find(x => String(x.id) === String(savedSub));
            if (found) selectedSubjectId = savedSub;
        }
    } catch(e) { }

    subjects.forEach(s => {
        const el = document.createElement('div');
        el.className = 'subject-item';
        el.textContent = s.name;
        el.dataset.id = s.id;
        el.onclick = () => {
            selectedSubjectId = s.id === selectedSubjectId ? null : s.id;
            // highlight
            document.querySelectorAll('.subject-item').forEach(it => it.classList.remove('active'));
            if (selectedSubjectId) el.classList.add('active');
            try { localStorage.setItem('selectedSubjectId', selectedSubjectId || ''); } catch(e) { }
            renderTable();
        };
        // mark restored selection
        try {
            if (selectedSubjectId && String(s.id) === String(selectedSubjectId)) el.classList.add('active');
        } catch(e) { }
        wrapper.appendChild(el);
    });
}
