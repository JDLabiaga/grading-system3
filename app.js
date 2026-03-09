const SUPABASE_URL = 'https://bjcqygaqqgknplzjbmiw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqY3F5Z2FxcWdrbnBsempibWl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDQ4NzMsImV4cCI6MjA4ODYyMDg3M30._I5BxEMAK7PtHc87fGhmlPJf31H3j525NqNoUjAgwR8';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function handleLogin() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) { document.getElementById('login-error').innerText = error.message; } 
    else { checkUser(); }
}

async function handleLogout() {
    await db.auth.signOut();
    location.reload();
}

async function checkUser() {
    const { data: { user } } = await db.auth.getUser();
    if (user) {
        document.getElementById('login-section').style.display = 'none';
        document.getElementById('dashboard-section').style.display = 'block';
        document.getElementById('welcome-text').innerText = `Instructor: ${user.email}`;
        
        // Load structure first, then records
        const subjects = await loadSubjects();
        renderStudentData(subjects);
    }
}

async function addSubject() {
    const name = document.getElementById('subject-name').value;
    if (!name) return;
    await db.from('subjects').insert([{ name }]);
    location.reload();
}

async function loadSubjects() {
    const { data: subjects } = await db.from('subjects').select('*').order('id');
    const header = document.getElementById('table-header');
    const inputRow = document.getElementById('input-row');
    
    if (!subjects) return [];

    subjects.forEach(sub => {
        let th = document.createElement('th');
        th.innerText = sub.name;
        header.insertBefore(th, header.lastElementChild);

        let td = document.createElement('td');
        td.innerHTML = `<input type="number" class="score-input" data-subid="${sub.id}" placeholder="0">`;
        inputRow.insertBefore(td, inputRow.lastElementChild);
    });
    return subjects;
}

async function renderStudentData(subjects) {
    const displayArea = document.getElementById('records-display');
    displayArea.innerHTML = ""; 

    const { data: students, error } = await db
        .from('students')
        .select('id, full_name, grades(subject_id, score)');

    if (error || !students) return;

    students.forEach(student => {
        let row = document.createElement('tr');
        row.innerHTML = `<td>${student.full_name}</td>`;
        
        subjects.forEach(sub => {
            const gradeRecord = student.grades.find(g => g.subject_id == sub.id);
            row.innerHTML += `<td class="saved-score">${gradeRecord ? gradeRecord.score : '0'}</td>`;
        });

        row.innerHTML += `<td><button onclick="deleteStudent(${student.id})" style="background:#cc0000; padding:5px 10px; font-size:12px; width:auto;">Delete</button></td>`;
        displayArea.appendChild(row);
    });
}

async function saveStudent() {
    const fullName = document.getElementById('new-student-name').value;
    if (!fullName) return alert("Enter name");

    const { data: student } = await db.from('students').insert([{ full_name: fullName }]).select().single();

    if (student) {
        const inputs = document.querySelectorAll('.score-input');
        const grades = Array.from(inputs).map(i => ({
            student_id: student.id,
            subject_id: i.dataset.subid,
            score: parseInt(i.value) || 0
        }));
        await db.from('grades').insert(grades);
        location.reload();
    }
}

async function deleteStudent(id) {
    if(confirm("Delete this student?")) {
        await db.from('students').delete().eq('id', id);
        location.reload();
    }
}

document.addEventListener('DOMContentLoaded', checkUser);