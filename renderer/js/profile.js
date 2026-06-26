const $ = (id) => document.getElementById(id);
const user = Session.requireAuth();

async function init() {
  const res = await window.nebula.getProfile(user.id);
  const u = res.user || user;
  $('displayName').value = u.displayName || '';
  $('email').value = u.email || '';
  $('avatar').value = u.avatar || '';
  paint(u);
}

function paint(u) {
  $('namePreview').textContent = u.displayName || u.username;
  $('userPreview').textContent = '@' + u.username;
  const a = $('avatarPreview');
  if (u.avatar) {
    a.style.backgroundImage = `url(${u.avatar})`;
    a.style.backgroundSize = 'cover';
    a.textContent = '';
  } else {
    a.style.backgroundImage = '';
    a.textContent = initials(u.displayName || u.username);
  }
}

$('saveBtn').addEventListener('click', async () => {
  const res = await window.nebula.updateProfile({
    userId: user.id,
    displayName: $('displayName').value.trim(),
    email: $('email').value.trim(),
    avatar: $('avatar').value.trim()
  });
  if (res.ok) {
    Session.set(res.user);
    paint(res.user);
    $('status').textContent = 'Saved ✓';
    setTimeout(() => $('status').textContent = '', 1800);
  }
});

init();
