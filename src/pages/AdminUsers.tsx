import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Users, Check, X, Clock, KeyRound, History } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";

type UserRole = {
  id: string;
  email: string;
  role: 'admin' | 'comercial';
  approved: boolean;
  created_at: string;
};

type ResetAudit = {
  id: string;
  target_email: string;
  admin_email: string;
  created_at: string;
};

export default function AdminUsers() {
  const [users, setUsers] = useState<UserRole[]>([]);
  const [audit, setAudit] = useState<ResetAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetTarget, setResetTarget] = useState<UserRole | null>(null);
  const [tempPassword, setTempPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  async function fetchAudit() {
    const { data } = await supabase
      .from('password_reset_audit' as never)
      .select('id, target_email, admin_email, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) setAudit(data as unknown as ResetAudit[]);
  }

  async function handleResetPassword() {
    if (!resetTarget) return;
    if (tempPassword.length < 6) {
      toast.error("A senha temporária precisa ter no mínimo 6 caracteres.");
      return;
    }
    setResetting(true);
    const { data, error } = await supabase.functions.invoke("admin-reset-password", {
      body: { userId: resetTarget.id, newPassword: tempPassword },
    });
    setResetting(false);
    if (error || (data && (data as { error?: string }).error)) {
      toast.error(
        (data as { error?: string })?.error || error?.message || "Erro ao redefinir senha"
      );
      return;
    }
    toast.success(
      `Senha temporária definida para ${resetTarget.email}. Ele será obrigado a trocar no próximo login.`
    );
    setResetTarget(null);
    setTempPassword("");
    fetchAudit();
  }

  useEffect(() => {
    fetchUsers();
    fetchAudit();
  }, []);

  async function fetchUsers() {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_roles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error("Erro ao carregar usuários");
      console.error(error);
    } else if (data) {
      setUsers(data as UserRole[]);
    }
    setLoading(false);
  }

  async function handleRoleChange(userId: string, newRole: 'admin' | 'comercial') {
    const { error } = await supabase
      .from('user_roles')
      .update({ role: newRole })
      .eq('id', userId);

    if (error) {
      toast.error("Erro ao atualizar perfil");
      console.error(error);
    } else {
      toast.success("Perfil atualizado com sucesso!");
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
    }
  }

  async function handleApprove(userId: string) {
    const { error } = await supabase
      .from('user_roles')
      .update({ approved: true })
      .eq('id', userId);

    if (error) {
      toast.error("Erro ao aprovar usuário");
      console.error(error);
    } else {
      toast.success("Usuário aprovado! Ele já pode acessar a ferramenta.");
      setUsers(users.map(u => u.id === userId ? { ...u, approved: true } : u));
    }
  }

  async function handleReject(userId: string, email: string) {
    if (!confirm(`Rejeitar o cadastro de ${email}? Isso remove o acesso dele — ele precisará se cadastrar de novo se quiser tentar novamente.`)) return;

    // Remove só o registro em user_roles. O usuário continua em auth.users mas sem role/aprovação,
    // então o app o desloga imediatamente ao tentar logar. Um admin pode limpar auth.users manualmente
    // pelo painel de Cloud se necessário.
    const { error } = await supabase
      .from('user_roles')
      .delete()
      .eq('id', userId);

    if (error) {
      toast.error("Erro ao rejeitar usuário");
      console.error(error);
    } else {
      toast.success("Cadastro rejeitado.");
      setUsers(users.filter(u => u.id !== userId));
    }
  }

  const pending = users.filter(u => !u.approved);
  const approved = users.filter(u => u.approved);

  if (loading && users.length === 0) {
    return (
      <div className="dark min-h-screen bg-background text-foreground">
        <AppHeader />
        <div className="p-8">Carregando usuários...</div>
      </div>
    );
  }

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <AppHeader />
      <div className="p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex items-center gap-3">
          <Users className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">Gerenciamento de Usuários</h1>
        </div>

        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-500" />
              Aguardando aprovação
              {pending.length > 0 && (
                <Badge variant="secondary" className="ml-2">{pending.length}</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Novos cadastros ficam bloqueados até você aprovar. Aprovados conseguem logar imediatamente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nenhum cadastro pendente no momento.
              </p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Cadastrado em</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.email}</TableCell>
                        <TableCell>{new Date(user.created_at).toLocaleString('pt-BR')}</TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            size="sm"
                            onClick={() => handleApprove(user.id)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            <Check className="h-4 w-4 mr-1" /> Aprovar
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleReject(user.id, user.email)}
                          >
                            <X className="h-4 w-4 mr-1" /> Rejeitar
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usuários aprovados</CardTitle>
            <CardDescription>Gerencie quem tem perfil de Administrador no sistema</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Data de Cadastro</TableHead>
                    <TableHead>Perfil de Acesso</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approved.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.email}</TableCell>
                      <TableCell>{new Date(user.created_at).toLocaleDateString('pt-BR')}</TableCell>
                      <TableCell>
                        <Select
                          value={user.role}
                          onValueChange={(value: 'admin' | 'comercial') => handleRoleChange(user.id, value)}
                        >
                          <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Selecione um perfil" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="comercial">Comercial</SelectItem>
                            <SelectItem value="admin">Administrador</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setResetTarget(user); setTempPassword(""); }}
                        >
                          <KeyRound className="h-4 w-4 mr-1" /> Redefinir senha
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {approved.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        Nenhum usuário aprovado ainda.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
      </div>

      <Dialog open={!!resetTarget} onOpenChange={(open) => { if (!open) { setResetTarget(null); setTempPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
            <DialogDescription>
              Você vai definir uma <strong>senha temporária</strong> para{" "}
              <span className="text-foreground font-medium">{resetTarget?.email}</span>.
              No próximo login, ele será obrigado a criar uma nova senha pessoal antes de acessar o sistema.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="temp-password">Senha temporária</Label>
            <Input
              id="temp-password"
              type="text"
              placeholder="mínimo 6 caracteres"
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Envie essa senha pro usuário por um canal seguro. Ele vai trocar assim que logar.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetTarget(null); setTempPassword(""); }}>
              Cancelar
            </Button>
            <Button onClick={handleResetPassword} disabled={resetting || tempPassword.length < 6}>
              {resetting ? "Redefinindo..." : "Redefinir senha"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
