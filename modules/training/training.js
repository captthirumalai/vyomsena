import { listTrainingCenters, listTrainingOfferings, listTrainingBookings, watchTrainingBookings } from '../../services/trainingService.js';
import { mountModuleActions, getModuleAction } from '../../shared/moduleHeader.js';

let bookingsUnsubscribe = null;
let latestCenters = [];
let latestOfferings = [];
let latestBookings = [];
let activeView = null;
let activeOperatorUid = null;

function toDateValue(value) {
  const raw = value?.toDate ? value.toDate() : value;
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function formatDate(value) {
  const date = toDateValue(value);
  return date ? date.toLocaleDateString() : 'N/A';
}

function normalizeStatus(status) {
  return `${status || 'PENDING'}`.trim().toUpperCase();
}

function resolveCenterName(center) {
  if (!center) return 'Unknown Center';
  return center.name || center.centerName || center.title || center.centerId || 'Unknown Center';
}

function resolveOfferingName(offering, centersById) {
  if (!offering) return 'Untitled Offering';
  const offeringTitle = offering.title || offering.name || offering.programName || offering.offeringId;
  const centerId = offering.trainingCenterId || offering.centerId;
  const centerName = resolveCenterName(centersById.get(centerId));
  return centerId ? `${offeringTitle} (${centerName})` : offeringTitle;
}

function resolveBookingDate(booking) {
  return booking.scheduledDate || booking.startDate || booking.trainingDate || booking.createdAt || null;
}

function renderTraining() {
  if (!activeView) return;

  const statusLabel = getModuleAction('training-status');
  const bookingsBody = activeView.querySelector('#training-bookings-body');
  if (!statusLabel || !bookingsBody) return;

  const centersById = new Map(latestCenters.map((center) => [center.centerId, center]));
  const offeringsById = new Map(latestOfferings.map((offering) => [offering.offeringId, offering]));

  const pendingCount = latestBookings.filter((booking) => normalizeStatus(booking.status) === 'PENDING').length;
  activeView.querySelector('#training-centers-total').textContent = `${latestCenters.length}`;
  activeView.querySelector('#training-offerings-total').textContent = `${latestOfferings.length}`;
  activeView.querySelector('#training-bookings-total').textContent = `${latestBookings.length}`;
  activeView.querySelector('#training-pending-total').textContent = `${pendingCount}`;

  statusLabel.textContent = `Live training records for operator ${activeOperatorUid}: ${latestCenters.length} centers, ${latestOfferings.length} offerings, ${latestBookings.length} bookings.`;

  if (!latestBookings.length) {
    bookingsBody.innerHTML = '<tr><td colspan="4">No training bookings available.</td></tr>';
    return;
  }

  const sortedBookings = [...latestBookings].sort((left, right) => {
    const leftDate = toDateValue(resolveBookingDate(left))?.getTime() || 0;
    const rightDate = toDateValue(resolveBookingDate(right))?.getTime() || 0;
    return rightDate - leftDate;
  });

  bookingsBody.innerHTML = sortedBookings
    .slice(0, 12)
    .map((booking) => {
      const offering = offeringsById.get(booking.offeringId);
      const offeringName = resolveOfferingName(offering, centersById);
      const userLabel = booking.userName || booking.userId || 'Unknown User';
      const status = normalizeStatus(booking.status);
      const dateLabel = formatDate(resolveBookingDate(booking));
      return `<tr>
        <td>${userLabel}</td>
        <td>${offeringName}</td>
        <td>${dateLabel}</td>
        <td>${status}</td>
      </tr>`;
    })
    .join('');
}

export async function init(view, context) {
  activeView = view;

  mountModuleActions('<span id="training-status" class="vs-page-chip">Loading training records...</span>');

  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'Training & Currency';
  }

  const cards = view.querySelectorAll('.card');
  cards.forEach((card, index) => {
    card.dataset.module = 'training';
    card.setAttribute('data-index', index + 1);
  });

  const operatorUid = context?.currentUser?.uid || null;
  activeOperatorUid = operatorUid;

  if (!operatorUid) {
    const statusLabel = getModuleAction('training-status');
    if (statusLabel) {
      statusLabel.textContent = 'No authorized operator found.';
    }
    return {
      destroy() {}
    };
  }

  try {
    const [centers, offerings, bookings] = await Promise.all([
      listTrainingCenters(),
      listTrainingOfferings(),
      listTrainingBookings(null)
    ]);
    latestCenters = centers;
    latestOfferings = offerings;
    latestBookings = bookings;
    renderTraining();
  } catch (error) {
    console.error('Training initial load failed:', error);
    const statusLabel = getModuleAction('training-status');
    if (statusLabel) {
      statusLabel.textContent = 'Unable to load training records right now.';
    }
  }

  bookingsUnsubscribe = watchTrainingBookings(
    null,
    (snapshot) => {
      latestBookings = snapshot.docs.map((item) => ({ bookingId: item.id, ...item.data() }));
      renderTraining();
    },
    (error) => console.error('Training bookings snapshot error:', error)
  );

  return {
    destroy() {
      bookingsUnsubscribe?.();
      bookingsUnsubscribe = null;
      latestCenters = [];
      latestOfferings = [];
      latestBookings = [];
      activeView = null;
      activeOperatorUid = null;
    }
  };
}
