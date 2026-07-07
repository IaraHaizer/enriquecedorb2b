import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Users, Check, X, Clock } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";

type UserRole = {
  id: string;
  email: string;
  role: 'admin' | 'comercial';
  approved: boolean;
  created_at: string;
};

export default function AdminUsers() {
  const [users, setUsers] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsers();
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
                    </TableRow>
                  ))}
                  {approved.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
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
    </div>
  );
}
