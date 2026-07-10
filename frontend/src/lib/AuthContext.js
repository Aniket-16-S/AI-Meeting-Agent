'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [department, setDepartment] = useState(null);
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [deptMeetingIds, setDeptMeetingIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Load active session from sessionStorage on mount with 10-minute inactivity check
  useEffect(() => {
    try {
      const storedCurrentUser = sessionStorage.getItem('saas_current_user');
      const storedOrg = sessionStorage.getItem('saas_org');
      const storedDept = sessionStorage.getItem('saas_dept');
      const storedUsers = sessionStorage.getItem('saas_users');
      const storedDepts = sessionStorage.getItem('saas_depts');

      const lastActiveStr = localStorage.getItem('saas_last_active');
      const now = Date.now();
      let sessionExpired = false;
      if (lastActiveStr && storedCurrentUser) {
        const lastActive = parseInt(lastActiveStr, 10);
        if (now - lastActive > 10 * 60 * 1000) { // 10 minutes
          sessionExpired = true;
        }
      }

      if (sessionExpired) {
        sessionStorage.clear();
        localStorage.removeItem('saas_last_active');
        setUser(null);
        setOrganization(null);
        setDepartment(null);
        setUsers([]);
        setDepartments([]);
        router.push('/login');
      } else {
        if (storedCurrentUser) {
          setUser(JSON.parse(storedCurrentUser));
          localStorage.setItem('saas_last_active', now.toString());
        }
        if (storedOrg) {
          setOrganization(JSON.parse(storedOrg));
        }
        if (storedDept) {
          setDepartment(JSON.parse(storedDept));
        }
        if (storedUsers) {
          setUsers(JSON.parse(storedUsers));
        }
        if (storedDepts) {
          setDepartments(JSON.parse(storedDepts));
        }
      }
    } catch (e) {
      console.error('Error loading session from sessionStorage', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Update last active timestamp on any user action
  useEffect(() => {
    if (!user) return;

    const updateActivity = () => {
      localStorage.setItem('saas_last_active', Date.now().toString());
    };

    updateActivity();

    window.addEventListener('click', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('scroll', updateActivity);

    return () => {
      window.removeEventListener('click', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('scroll', updateActivity);
    };
  }, [user]);

  // Sync active department meetings from the backend database
  useEffect(() => {
    if (!department?.id) {
      setDeptMeetingIds([]);
      return;
    }
    fetch(`/api/departments/${department.id}/meetings`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.meeting_ids) {
          setDeptMeetingIds(data.meeting_ids);
        }
      })
      .catch((err) => console.error("Failed to fetch department meetings", err));
  }, [department?.id]);

  const saveSession = (currUser, activeOrg, activeDept, allUsers = null, allDepts = null) => {
    setUser(currUser);
    setOrganization(activeOrg);
    setDepartment(activeDept);

    if (allUsers) {
      setUsers(allUsers);
      sessionStorage.setItem('saas_users', JSON.stringify(allUsers));
    }
    if (allDepts) {
      setDepartments(allDepts);
      sessionStorage.setItem('saas_depts', JSON.stringify(allDepts));
    }

    if (currUser) {
      sessionStorage.setItem('saas_current_user', JSON.stringify(currUser));
    } else {
      sessionStorage.removeItem('saas_current_user');
    }
    if (activeOrg) {
      sessionStorage.setItem('saas_org', JSON.stringify(activeOrg));
    } else {
      sessionStorage.removeItem('saas_org');
    }
    if (activeDept) {
      sessionStorage.setItem('saas_dept', JSON.stringify(activeDept));
    } else {
      sessionStorage.removeItem('saas_dept');
    }
  };

  const login = async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || 'Invalid email or password');
    }
    const data = await res.json();
    localStorage.setItem('saas_last_active', Date.now().toString());
    saveSession(data.user, data.organization, data.department, data.users, data.departments);
    router.push('/');
    return data.user;
  };

  const logout = () => {
    saveSession(null, null, null);
    sessionStorage.removeItem('saas_users');
    sessionStorage.removeItem('saas_depts');
    localStorage.removeItem('saas_last_active');
    setUsers([]);
    setDepartments([]);
    router.push('/login');
  };

  const registerOrg = async (orgName, adminName, adminEmail, adminPassword, adminDepartment) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org_name: orgName,
        admin_name: adminName,
        admin_email: adminEmail,
        admin_password: adminPassword,
        department_name: adminDepartment,
      }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || 'Failed to register organization');
    }
    const data = await res.json();
    localStorage.setItem('saas_last_active', Date.now().toString());
    saveSession(data.user, data.organization, data.department, data.users, data.departments);
    router.push('/');
    return data.user;
  };

  const createDepartment = async (name) => {
    if (!organization) throw new Error('No active organization');
    const res = await fetch(`/api/departments?organization_id=${organization.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || 'Failed to create department');
    }
    const newDept = await res.json();
    
    const updatedDepts = [...departments, newDept];
    setDepartments(updatedDepts);
    sessionStorage.setItem('saas_depts', JSON.stringify(updatedDepts));
    return newDept;
  };

  const createUser = async (name, email, password, role, targetDeptId) => {
    if (!organization) throw new Error('No active organization');
    
    // Ensure role matches backend (admin or employee)
    const dbRole = role === 'admin' ? 'admin' : 'employee';

    const res = await fetch(`/api/users?organization_id=${organization.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        password,
        role: dbRole,
        department_id: targetDeptId,
      }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || 'Failed to create user');
    }
    const newUser = await res.json();
    
    const updatedUsers = [...users, newUser];
    setUsers(updatedUsers);
    sessionStorage.setItem('saas_users', JSON.stringify(updatedUsers));
    return newUser;
  };

  const switchDepartment = async (deptId) => {
    const dept = departments.find((d) => d.id === deptId);
    if (dept) {
      const res = await fetch(`/api/users/${user.id}/department`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ department_id: deptId }),
      });
      if (!res.ok) {
        throw new Error('Failed to update department');
      }
      setDepartment(dept);
      sessionStorage.setItem('saas_dept', JSON.stringify(dept));
      
      const updatedUser = { ...user, departmentId: deptId };
      setUser(updatedUser);
      sessionStorage.setItem('saas_current_user', JSON.stringify(updatedUser));
      
      const updatedUsers = users.map((u) => u.id === user.id ? { ...u, departmentId: deptId } : u);
      setUsers(updatedUsers);
      sessionStorage.setItem('saas_users', JSON.stringify(updatedUsers));
    }
  };

  const deleteUserInContext = async (userId, adminPassword) => {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_email: user.email,
        password: adminPassword,
      }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || 'Failed to delete user');
    }
    const updatedUsers = users.filter((u) => u.id !== userId);
    setUsers(updatedUsers);
    sessionStorage.setItem('saas_users', JSON.stringify(updatedUsers));
  };

  const deleteDepartmentInContext = async (deptId, adminPassword) => {
    const res = await fetch(`/api/departments/${deptId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_email: user.email,
        password: adminPassword,
      }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || 'Failed to delete department');
    }
    const updatedDepts = departments.filter((d) => d.id !== deptId);
    setDepartments(updatedDepts);
    sessionStorage.setItem('saas_depts', JSON.stringify(updatedDepts));

    const updatedUsers = users.map((u) => u.departmentId === deptId ? { ...u, departmentId: null } : u);
    setUsers(updatedUsers);
    sessionStorage.setItem('saas_users', JSON.stringify(updatedUsers));
  };

  const assignUserDepartmentInContext = async (userId, deptId) => {
    const res = await fetch(`/api/users/${userId}/department`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department_id: deptId }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || 'Failed to assign department');
    }
    const updatedUsers = users.map((u) => u.id === userId ? { ...u, departmentId: deptId } : u);
    setUsers(updatedUsers);
    sessionStorage.setItem('saas_users', JSON.stringify(updatedUsers));
  };

  const linkMeetingToDepartment = async (meetingId, deptId) => {
    await fetch(`/api/departments/${deptId}/meetings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting_id: meetingId }),
    });
    if (deptId === department?.id) {
      setDeptMeetingIds((prev) => [...prev, meetingId]);
    }
  };

  const getDepartmentMeetingIds = (deptId) => {
    return deptMeetingIds;
  };

  const isMeetingInDepartment = (meetingId, deptId) => {
    return deptMeetingIds.includes(meetingId);
  };

  const activeOrgUsers = users.filter((u) => u.organizationId === organization?.id);
  const activeOrgDepartments = departments.filter((d) => d.organizationId === organization?.id);

  return (
    <AuthContext.Provider
      value={{
        user,
        organization,
        department,
        users: activeOrgUsers,
        departments: activeOrgDepartments,
        deptMeetingIds,
        loading,
        login,
        logout,
        registerOrg,
        createDepartment,
        createUser,
        switchDepartment,
        linkMeetingToDepartment,
        getDepartmentMeetingIds,
        isMeetingInDepartment,
        deleteUserInContext,
        deleteDepartmentInContext,
        assignUserDepartmentInContext,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
