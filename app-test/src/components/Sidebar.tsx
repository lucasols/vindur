import { Link, useLocation } from 'react-router-dom';
import { styled } from 'vindur';

const SidebarContainer = styled.div`
  width: 250px;
  height: 100vh;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(10px);
  padding: 20px 0;
  position: fixed;
  left: 0;
  top: 0;
  overflow-y: auto;
  z-index: 1000;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
`;

const Title = styled.h1`
  color: white;
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 30px 0;
  text-align: center;
  padding: 0 20px;
`;

const NavList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
`;

const NavItem = styled.li`
  margin: 0;
`;

const NavLink = styled.div`
  display: block;
  padding: 12px 20px;
  color: rgba(255, 255, 255, 0.9);
  text-decoration: none;
  font-weight: 400;
  background: transparent;
  border-left: 3px solid transparent;
  transition: all 0.2s ease;
  cursor: pointer;

  &.active {
    color: white;
    font-weight: 600;
    background: rgba(255, 255, 255, 0.15);
    border-left: 3px solid #667eea;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }
`;

import { demos } from '../routes';

export function Sidebar() {
  const location = useLocation();

  return (
    <SidebarContainer>
      <Title>Vindur</Title>
      <NavList>
        {demos.map((demo) => (
          <NavItem key={demo.path}>
            <Link to={demo.path} css={`text-decoration: none;`}>
              <NavLink className={location.pathname === demo.path ? 'active' : ''}>
                {demo.name}
              </NavLink>
            </Link>
          </NavItem>
        ))}
      </NavList>
    </SidebarContainer>
  );
}