const $ = (id) => document.getElementById(id);

async function doRegister() {
  const displayName = $('displayName').value.trim();
  const username = $('username').value.trim();
  const email = $('email').value.trim();
  const password = $('password').value;
  const err = $('error');
  err.textContent = '';

  if (!username || !password) { err.textContent = 'Username and password are required.'; return; }
  if (password.length < 4) { err.textContent = 'Password must be at least 4 characters.'; return; }

  const res = await window.nebula.register({ username, email, password, displayName });
  if (res.ok) {
    Session.set(res.user);
    location.href = 'chat.html';
  } else {
    err.textContent = res.error || 'Registration failed.';
  }
}

$('registerBtn').addEventListener('click', doRegister);
$('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doRegister(); });
