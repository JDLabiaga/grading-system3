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
    // SINGLE TOGGLE FUNCTION FOR ALL DEVICES
    const toggleSidebar = () => {
        const sidebar = $('sidebar');
        const overlay = $('sidebar-overlay');
        
        if (window.innerWidth > 1024) {
            // DESKTOP: Toggle 'collapsed'
            sidebar.classList.toggle('collapsed');
        } else {
            // MOBILE: Toggle 'open'
            sidebar.classList.toggle('open');
            overlay.style.display = sidebar.classList.contains('open') ? 'block' : 'none';
        }
    };

    // All triggers
    $('mobile-menu-btn').onclick = toggleSidebar;
    $('close-sidebar').onclick = toggleSidebar;
    $('sidebar-overlay').onclick = toggleSidebar;

    // Close sidebar on mobile when a semester is picked
    $('semester-select').onchange = (e) => {
        currentSemesterId = e.target.value;
        localStorage.setItem('selectedSemesterId', currentSemesterId || '');
        loadDashboard();
        
        if(window.innerWidth <= 1024) {
            $('sidebar').classList.remove('open');
            $('sidebar-overlay').style.display = 'none';
        }
    };

    // Standard Buttons
    $('add-semester-btn').onclick = () => openModal('semester-modal');
    $('add-subject-btn').onclick = () => openModal('subject-modal');
    $('add-student-btn').onclick = openAddStudentModal;
    $('save-semester-btn').onclick = addSemester;
    $('save-subject-btn').onclick = addSubject;
    $('save-student-btn').onclick = saveStudent;
    $('update-student-btn').onclick = updateStudent;
    $('confirm-delete-btn').onclick = executeDelete;

    // Filters
    $('search-input').oninput = renderTable;
    $('filter-year').onchange = renderTable;
    $('filter-section').onchange = renderTable;

    // Modal Close Logic
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
            <input type="number" step="0.1" class="subject-grade-input glass-input-table" data-subject-id="${sub.id}" placeholder="1.0 - 5.0" style="width:100%">
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

// Set global function for the trash icon in table
window.setStudentToDelete = (id) => {
    studentToDelete = id;
    openModal('confirm-modal');
};

async function executeDelete() {
    if (!studentToDelete) return;

    try {
        const { error } = await db.from('students2').delete().eq('id', studentToDelete);
        if (error) throw error;

        showToast('Student removed successfully', 'success');
        closeModal('confirm-modal');
        closeModal('edit-modal');
        
        studentToDelete = null; 
        await loadStudents(); 
    } catch (err) {
        console.error("Delete Error:", err);
        showToast('Delete failed', 'danger');
    }
}

// Global DELETE SUBJECT
window.deleteSubject = async (subjectId) => {
    if (!confirm("Delete this subject and all associated grades?")) return;
    
    const { error } = await db.from('subjects2').delete().eq('id', subjectId);
    if (error) {
        showToast("Error deleting subject", "danger");
    } else {
        showToast("Subject deleted", "success");
        loadDashboard(); 
    }
};

// Global DELETE SEMESTER
window.deleteSemester = async () => {
    if (!currentSemesterId) return;
    const name = $("semester-select").options[$("semester-select").selectedIndex].text;
    
    if (!confirm(`Are you sure? This will permanently delete the semester "${name}" and ALL students/grades inside it.`)) return;

    const { error } = await db.from('semesters2').delete().eq('id', currentSemesterId);
    if (error) {
        showToast("Error deleting semester", "danger");
    } else {
        showToast("Semester deleted", "success");
        localStorage.removeItem('selectedSemesterId');
        location.reload(); 
    }
};

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
        '<th>GWA</th><th>Action</th>';

    $('table-body').innerHTML = filtered.map(s => {
        let sum = 0, count = 0;
        const cells = subjects.map(sub => {
            const g = s.grades.find(g => g.subject_id === sub.id);
            const val = (g && g.score !== null) ? g.score : '-';
            if (val !== '-') { sum += parseFloat(val); count++; }
            return `<td class="text-center">${val}</td>`;
        }).join('');

        const gwa = count > 0 ? (sum / count).toFixed(2) : '0.00';
        const isPass = parseFloat(gwa) > 0 && parseFloat(gwa) <= 3.0;

        return `
            <tr>
                <td><strong>${s.full_name}</strong><br><small>${s.year_level || ''} ${s.section || ''}</small></td>
                ${cells}
                <td class="text-center"><span class="badge ${isPass ? 'pass' : 'fail'}">${gwa}</span></td>
                <td class="text-center">
                    <button class="btn-icon text-danger" onclick="setStudentToDelete('${s.id}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>`;
    }).join('');

    updateStats(filtered);
}

function updateStats(data) {
    const total = data.length;
    $('stat-total-students').textContent = total;
    
    let allSum = 0, allCount = 0, passingCount = 0;
    data.forEach(s => {
        let sSum = 0, sCount = 0;
        s.grades.forEach(g => { if(g.score) { allSum += g.score; allCount++; sSum += g.score; sCount++; } });
        if(sCount > 0 && (sSum/sCount) <= 3.0) passingCount++;
    });

    $('stat-average-class').textContent = allCount ? (allSum / allCount).toFixed(2) : '0.00';
    $('stat-pass-rate').textContent = total ? Math.round((passingCount / total) * 100) + '%' : '0%';
    
    updateChart(subjects.map(s => s.name), subjects.map(sub => {
        const subGrades = data.flatMap(s => s.grades).filter(g => g.subject_id === sub.id && g.score);
        return subGrades.length ? (subGrades.reduce((a,b) => a + b.score, 0) / subGrades.length).toFixed(2) : 5;
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
    $('subject-list').innerHTML = subjects.map(s => `
        <div class="subj-pill-container" style="display:flex; justify-content:space-between; align-items:center; background: rgba(255,255,255,0.05); padding: 8px; border-radius: 6px; margin-bottom: 5px;">
            <div class="subj-pill" style="color:white; font-size:0.8rem;">• ${s.name}</div>
            <button class="btn-icon-sm" onclick="deleteSubject('${s.id}')" style="color:rgba(255,255,255,0.5); background:none; border:none; cursor:pointer;">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `).join('');
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
        data: { labels: [], datasets: [{ label: 'Avg Grade', data: [], backgroundColor: '#800000' }] },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            scales: { 
                y: { 
                    min: 1, 
                    max: 5, 
                    reverse: true, 
                    ticks: { stepSize: 1 }
                } 
            } 
        }
    });
}

function updateChart(labels, data) {
    if (!dashboardChart) return;
    dashboardChart.data.labels = labels;
    dashboardChart.data.datasets[0].data = data;
    dashboardChart.update();
}