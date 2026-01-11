setTimeout(() => {
  const flash = document.getElementById("flash-message");
  if (flash) {
    flash.style.display = "none";
  }
}, 5000); // 3 seconds


// profile icon 
const profileBtn = document.getElementById('profileBtn');
const profileMenu = document.getElementById('profileMenu');

// Toggle menu on click
profileBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  profileMenu.classList.toggle('hidden');
});

// Close menu if clicked anywhere else on the screen
document.addEventListener('click', () => {
  profileMenu.classList.add('hidden');
});

// Stop closing when clicking inside the menu
profileMenu.addEventListener('click', (e) => {
  e.stopPropagation();
});