/* =========================================================
 * ★★★ Firebase 연결 설정 ★★★
 *
 * 비워두면(null) → '이 기기 저장 모드'
 *   교실 컴퓨터/태블릿 한 대로 진행. 반코드는 이 기기 안에서만 쓰여요.
 *
 * 채워 넣으면 → '클라우드 모드'
 *   선생님: 반 만들기 → 6자리 반코드 + 선생님 비밀번호 (구글 로그인 없음)
 *   학생:   어느 기기에서나 반코드 6자리로 입장, 뽑기를 생방송으로 봄
 *   학년:   6자리 학년코드로 여러 선생님이 역할 세트·최종 역할표 공유
 *
 * Firebase 콘솔 → 프로젝트 설정(⚙) → 일반 → 내 앱 → 웹 앱 → 'SDK 설정 및 구성'의
 * firebaseConfig 값을 그대로 아래 ★ 자리에 붙여 넣으세요.
 * 그리고 Authentication → 로그인 방법 → '익명'을 사용 설정하세요. (구글 로그인은 필요 없어요)
 * ========================================================= */

window.FIREBASE_CONFIG = null; // ★ 여기를 아래처럼 바꾸세요

/* ★ 예시 (따옴표 안의 값을 내 프로젝트 값으로)
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDUcEZC-Olmm9AGvWoe0GED1QoFP3eYaUY",
  authDomain: "role-onair.firebaseapp.com",
  projectId: "role-onair",
  storageBucket: "role-onair.firebasestorage.app",
  messagingSenderId: "461905129460",
  appId: "1:461905129460:web:1cc97db7a01b2fa204d3a1",
  measurementId: "G-W7HHM6NQR8"
};
*/
