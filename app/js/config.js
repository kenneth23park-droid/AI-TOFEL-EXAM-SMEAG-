/* =============================================================
 * SMEAG TOEFL — 전역 설정 (담당 A)
 * 클래식 스크립트. window.SMEAG_CONFIG 하나만 정의한다.
 * supabaseUrl / supabaseAnonKey 가 비어 있으면 동기화는 비활성.
 * ============================================================= */
(function () {
  'use strict';

  window.SMEAG_CONFIG = {
    /* Supabase 접속 정보. 비어 있으면 SMEAG_SYNC.enabled()===false 로 동기화만 꺼진다.
       프로젝트: smeag-toefl (ap-northeast-2). anon key 는 공개되어도 되는 키이며,
       RLS 로 본인 행만 접근 가능하도록 막혀 있다. */
    supabaseUrl: 'https://qrmidnmlethqvdbmnyun.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFybWlkbm1sZXRocXZkYm1ueXVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3Mzg3NzQsImV4cCI6MjEwMTMxNDc3NH0.U2cprYXkpIS_1tSAiEjCFuHAztZRwIIK6DYCCowgxg4',
    /* 유일하게 허용된 외부 CDN (sync.js 전용, 로드 실패해도 앱은 동작해야 함) */
    supabaseJsCdn: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
    /* 녹음 파일 업로드 버킷 */
    storageBucket: 'toefl-recordings',
    /* 응시자 정보 (프로토타입 단계에서는 고정값) */
    student: { name: 'Sunny', code: 's2025001' },
    /* true 면 콘솔에 디버그 로그 출력 */
    debug: false
  };
})();
