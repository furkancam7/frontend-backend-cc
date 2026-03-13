export const MAP_STYLES = `
  /* Tactical Popup Styles */
  .tactical-popup-wrapper .mapboxgl-popup-content {
    background: transparent;
    padding: 0;
    box-shadow: none;
    border: none;
  }
  .tactical-popup-wrapper .mapboxgl-popup-tip {
    display: none; /* Hide default tip */
  }

  /* Device Popup Styles */
  .device-popup-wrapper .mapboxgl-popup-content {
    background: transparent;
    padding: 0;
    box-shadow: none;
    border: none;
  }
  .device-popup-wrapper .mapboxgl-popup-tip {
    display: none;
  }
  
  /* We simulate the leader line and box */
  .tactical-box {
    background: rgba(10, 10, 10, 0.95);
    border: 1px solid rgba(100, 100, 100, 0.3);
    border-left: 2px solid currentColor;
    color: #eee;
    font-family: 'Courier New', monospace;
    font-size: 11px;
    width: 240px;
    position: relative;
    box-shadow: 0 10px 30px rgba(0,0,0,0.8);
    margin-bottom: 10px;
  }

  /* Hide the green leader line and dot */
  .tactical-box::after, .tactical-box::before {
    display: none;
  }

  .tactical-header {
    background: rgba(30, 30, 30, 0.5);
    padding: 6px 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(100, 100, 100, 0.2);
  }
  .tactical-id {
    font-weight: bold;
    color: #ffffff; /* White text for class name */
  }
  .tactical-status {
    font-size: 9px;
    color: #666;
    letter-spacing: 1px;
  }

  .tactical-image-container {
    position: relative;
    height: 140px;
    background: #000;
    overflow: hidden;
  }
  .tactical-image {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .no-image {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #555;
  }

  /* Reticle Overlay */
  .tactical-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    border: 1px solid rgba(252,88,28,0.1);
  }

  .tactical-footer {
    padding: 8px 10px;
    display: flex;
    justify-content: space-between;
    background: rgba(0,0,0,0.2);
    color: #888;
  }
  .tactical-coords {
      padding: 0 10px 8px 10px;
      display: flex;
      justify-content: space-between;
      background: rgba(0,0,0,0.2);
      color: #666;
      font-size: 9px;
  }
  .tactical-footer .value, .tactical-coords .value {
    color: #ccc;
  }

  /* Custom Scrollbar for Detection Gallery */
  .custom-scrollbar::-webkit-scrollbar {
      height: 4px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.3);
      border-radius: 2px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
      background: #10302C;
      border-radius: 2px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background: #FC581C;
  }
`;
