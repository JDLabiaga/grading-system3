const SUPABASE_URL = 'https://bjcqygaqqgknplzjbmiw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqY3F5Z2FxcWdrbnBsempibWl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDQ4NzMsImV4cCI6MjA4ODYyMDg3M30._I5BxEMAK7PtHc87fGhmlPJf31H3j525NqNoUjAgwR8'; 
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentSemesterId = null;
let subjects = [];
let students = [];
let editingStudentId = null;

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
    loadSemesters();
    bindEvents();
});

function bindEvents() {
    $('semester-select').onchange = (e) => {
        currentSemesterId = e.target.value;
        localStorage.setItem('selectedSemesterId', currentSemesterId || '');
        loadDashboard();
    };

    $('add-semester-btn').onclick = () => openModal('semester-modal');
    $('save-semester-btn').onclick = addSemester;
    
    // Add Subject UI connection
    $('add-subject-btn').onclick = () => openModal('subject-modal');
    $('save-subject-btn').onclick = addSubject;
    
    $('add-student-btn').onclick = openAddStudentModal;
    $('save-student-btn').onclick = saveStudent;

    // Real-time Search
    if ($('search-input')) {
        $('search-input').oninput = () => renderTable();
    }

    // --- UNIVERSAL CANCEL FIX ---
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (btn && btn.innerText.toLowerCase().includes('cancel')) {
            e.preventDefault();
            const activeModal = document.querySelector('.modal-overlay.active');
            if (activeModal) closeModal(activeModal.id);
        }
    });
}

async function loadDashboard() {
    if (!currentSemesterId) return;
    
    const { data: subData } = await db.from('subjects2').select('*').eq('semester_id', currentSemesterId);
    subjects = subData || [];
    
    renderSubjectList();
    $('table-section').style.display = 'block';
    
    if (subjects.length > 0) {
        $('no-subjects-state').style.display = 'none';
        $('add-student-btn').style.display = 'flex';
        await loadStudents();
    } else {
        $('no-subjects-state').style.display = 'flex';
        $('add-student-btn').style.display = 'none';
    }
}

async function loadStudents() {
    const { data: studentList } = await db.from('students2').select('*').eq('semester_id', currentSemesterId);
    if (!studentList) return;

    const ids = studentList.map(s => s.id);
    const { data: gradeData } = await db.from('grades2').select('*').in('student_id', ids);

    students = studentList.map(s => ({
        ...s,
        grades: (gradeData || []).filter(g => g.student_id === s.id)
    }));
    renderTable();
}

function openAddStudentModal() {
    const container = $('grade-inputs');
    container.innerHTML = '<label style="font-weight:bold; display:block; margin:10px 0;">Subject Grades</label>';
    subjects.forEach(sub => {
        container.innerHTML += `
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <span>${sub.name}</span>
                <input type="number" class="subject-grade-input" style="width:70px;">
            </div>`;
    });
    openModal('student-modal');
}

async function saveStudent() {
    const name = $('new-student-name').value.trim();
    if (!name) return;

    let studentId = editingStudentId;

    if (editingStudentId) {
        await db.from('students2').update({ full_name: name, year_level: $('new-student-year').value, section: $('new-student-section').value }).eq('id', editingStudentId);
    } else {
        const { data } = await db.from('students2').insert([{ full_name: name, semester_id: currentSemesterId, year_level: $('new-student-year').value, section: $('new-student-section').value }]).select().single();
        studentId = data.id;
    }

    const gradeInputs = document.querySelectorAll('.subject-grade-input');
    const promises = Array.from(gradeInputs).map((input, i) => {
        return db.from('grades2').upsert({ student_id: studentId, subject_id: subjects[i].id, score: input.value || null }, { onConflict: 'student_id,subject_id' });
    });

    await Promise.all(promises);
    closeModal('student-modal');
    loadStudents();
}

function renderTable() {
    const body = $('table-body');
    const query = $('search-input')?.value.toLowerCase() || "";
    body.innerHTML = '';

    students.filter(s => s.full_name.toLowerCase().includes(query)).forEach(s => {
        let row = `<tr><td><b>${s.full_name}</b><br><small>${s.year_level}-${s.section}</small></td>`;
        let total = 0, count = 0;

        subjects.forEach(sub => {
            const g = s.grades.find(grade => grade.subject_id === sub.id);
            const score = g?.score || '';
            if (score !== '') { total += parseFloat(score); count++; }
            row += `<td class="text-center">${score}</td>`;
        });

        const gwa = count > 0 ? (total / count).toFixed(1) : '0.0';
        row += `<td><span class="badge ${gwa >= 75 ? 'pass' : 'fail'}">${gwa}</span></td>
                <td>
                    <button class="btn-icon edit" onclick="editStudent('${s.id}')"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-icon delete" onclick="deleteStudent('${s.id}')"><i class="fa-solid fa-trash"></i></button>
                </td></tr>`;
        body.innerHTML += row;
    });
}

function editStudent(id) {
    const s = students.find(stud => stud.id === id);
    editingStudentId = id;
    $('new-student-name').value = s.full_name;
    openAddStudentModal();
}

async function deleteStudent(id) {
    if (confirm("Delete student?")) {
        await db.from('grades2').delete().eq('student_id', id);
        await db.from('students2').delete().eq('id', id);
        loadStudents();
    }
}

async function addSubject() {
    const name = $('new-subject-name').value;
    await db.from('subjects2').insert([{ name, semester_id: currentSemesterId }]);
    closeModal('subject-modal');
    loadDashboard();
}

async function addSemester() {
    const name = $('semester-name').value;
    await db.from('semesters2').insert([{ name }]);
    closeModal('semester-modal');
    loadSemesters();
}

function openModal(id) { $(id).classList.add('active'); }
function closeModal(id) { $(id).classList.remove('active'); editingStudentId = null; }

async function loadSemesters() {
    const { data } = await db.from('semesters2').select('*');
    const select = $('semester-select');
    select.innerHTML = '<option value="">Select Semester</option>';
    data?.forEach(sem => select.innerHTML += `<option value="${sem.id}">${sem.name}</option>`);
}

function renderSubjectList() {
    $('subject-list').innerHTML = subjects.map(s => `<span class="badge">${s.name}</span>`).join(' ');
}