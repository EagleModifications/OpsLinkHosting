// ui-alerts.js
const modal = document.getElementById("uiModal");
const titleEl = document.getElementById("uiTitle");
const msgEl = document.getElementById("uiMessage");
let btnOk = document.getElementById("uiConfirm");
let btnCancel = document.getElementById("uiCancel");

/**
 * Close the modal with fade animation and cleanup event listeners
 */
function closeModal() {
  modal.classList.add("hidden");

  // Replace buttons to remove old event listeners
  btnOk.replaceWith(btnOk.cloneNode(true));
  btnCancel.replaceWith(btnCancel.cloneNode(true));

  // Reassign references
  btnOk = document.getElementById("uiConfirm");
  btnCancel = document.getElementById("uiCancel");
}

/**
 * Show an alert modal
 * @param {string} message - Message text
 * @param {string} title - Modal title
 * @returns {Promise<void>}
 */
function uiAlert(message, title = "Notice") {
  return new Promise(resolve => {
    titleEl.textContent = title;
    msgEl.textContent = message;
    btnCancel.style.display = "none";
    btnOk.textContent = "OK";

    modal.classList.remove("hidden");

    btnOk.onclick = () => {
      closeModal();
      resolve();
    };
  });
}

/**
 * Show a confirm modal
 * @param {string} message - Message text
 * @param {string} title - Modal title
 * @returns {Promise<boolean>} - Resolves true if confirmed, false if canceled
 */
function uiConfirm(message, title = "Confirm") {
  return new Promise(resolve => {
    titleEl.textContent = title;
    msgEl.textContent = message;
    btnCancel.style.display = "inline-block";
    btnOk.textContent = "Confirm";

    modal.classList.remove("hidden");

    btnOk.onclick = () => {
      closeModal();
      resolve(true);
    };

    btnCancel.onclick = () => {
      closeModal();
      resolve(false);
    };
  });
}
