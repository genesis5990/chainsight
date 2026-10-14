import { AuthBar } from '../../components/AuthBar';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthBar />
      {children}
    </>
  );
}
